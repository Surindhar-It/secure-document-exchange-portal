import { db } from "./db";
import { writeAuditLog } from "./audit";
import os from "os";
import { NextRequest } from "next/server";

// Retrieve the first non-internal IPv4 system network address
export function getSystemNetworkIp(): string {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (!net.internal && net.family === "IPv4") {
          return net.address;
        }
      }
    }
  } catch {
  }
  return "127.0.0.1";
}

// Extract client IP and map loopback inputs to the local network IP
export function resolveClientIp(req: NextRequest): string {
  let ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  
  if (ip.startsWith("::ffff:")) {
    ip = ip.substring(7);
  }
  
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") {
    return getSystemNetworkIp();
  }
  
  return ip;
}

// Global In-Memory Rate Limiting map
const rateLimitMap = new Map<string, number[]>();
const MAX_REQUESTS = 30; // 30 requests per minute
const WINDOW_MS = 60 * 1000;

export function evaluateRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip) || [];
  
  // Prune expired timestamps
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);
  
  if (timestamps.length >= MAX_REQUESTS) {
    rateLimitMap.set(ip, timestamps);
    return { allowed: false, remaining: 0 };
  }

  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return { allowed: true, remaining: MAX_REQUESTS - timestamps.length };
}

interface ThreatInput {
  ipAddress: string;
  userEmail?: string | null;
  action: string; // LOGIN_FAIL, DOWNLOAD_SPIKE, IP_RESTRICTION_BYPASS, GEO_MISMATCH
  details?: Record<string, unknown> | null;
}

interface ThreatReport {
  riskScore: number;
  confidence: number;
  threatType: string;
  isThreat: boolean;
  source: "AI_ENGINE" | "FALLBACK_RULE_ENGINE";
  details: string;
}


// 2. Evaluate access threat (Integrates Python microservice and local heuristics)
export async function evaluateAccessThreat({ ipAddress, userEmail = null, action, details = null }: ThreatInput): Promise<ThreatReport> {
  // 1. Fetch telemetry logs for user/IP context
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentFailures = await db.auditLog.count({
    where: {
      action: "LOGIN_FAIL",
      ipAddress,
      timestamp: { gte: fiveMinAgo },
    },
  });

  const requestVolume = (details?.volumeMb as number) || 0.5;
  const requestsPerMin = (details?.requestsPerMin as number) || 10;
  const geoAnomaly = details?.geoAnomaly ? 1 : 0;

  // 2. AI Engine (Isolation Forest FastAPI Service)
  try {
    const res = await fetch("http://127.0.0.1:8000/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        failed_logins: recentFailures,
        request_volume_mb: requestVolume,
        requests_per_min: requestsPerMin,
        geo_anomaly: geoAnomaly,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const report: ThreatReport = {
        riskScore: data.risk_score,
        confidence: data.confidence,
        threatType: data.threat_type,
        isThreat: data.risk_score >= 0.7,
        source: "AI_ENGINE",
        details: data.explanation || "Classified by Isolation Forest anomaly detector.",
      };

      if (report.isThreat) {
        await logThreat(ipAddress, userEmail, action, report);
      }
      return report;
    }
  } catch {
    // Graceful fallback to rule-based evaluation if FastAPI is offline
    console.warn("AI security engine offline. Cascading to rule-based fallback...");
  }

  // 3. Fallback Local Rule Engine
  let riskScore = 0.1;
  let threatType = "NONE";
  const confidence = 0.95;
  let explanation = "Normal activity.";

  // Rule A: Brute Force Login
  if (action === "LOGIN_FAIL") {
    // Count failed logins for this email / IP in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentFails = await db.auditLog.count({
      where: {
        action: "LOGIN_FAIL",
        ipAddress: ipAddress,
        timestamp: { gte: fiveMinutesAgo },
      },
    });

    if (recentFails >= 5) {
      riskScore = 0.9;
      threatType = "BRUTE_FORCE";
      explanation = `Suspicious login activity: ${recentFails} failed attempts from IP ${ipAddress} in 5 mins.`;
    } else if (recentFails >= 3) {
      riskScore = 0.5;
      threatType = "BRUTE_FORCE";
      explanation = `Elevated login activity: ${recentFails} failed attempts.`;
    }
  }

  // Rule B: High volume downloads (possible exfiltration)
  if (action === "DOWNLOAD") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const downloadsInHour = await db.auditLog.count({
      where: {
        action: "DOWNLOAD",
        userEmail: userEmail || undefined,
        timestamp: { gte: oneHourAgo },
      },
    });

    if (downloadsInHour > 30) {
      riskScore = 0.85;
      threatType = "RATE_LIMIT_EXCEEDED";
      explanation = `High-volume downloads detected: ${downloadsInHour} files downloaded in 1 hour. Potential data exfiltration.`;
    }
  }

  // Rule C: Geographic anomaly simulation (if country code doesn't match expected)
  if (action === "GEO_MISMATCH" || details?.geoMismatch) {
    riskScore = 0.8;
    threatType = "GEO_ANOMALY";
    explanation = `Access requested from unapproved or anomalous geographic location: ${details?.geoCountry || "Unknown"}.`;
  }

  // Rule D: IP Blacklist bypass attempt
  if (action === "IP_RESTRICTION_BYPASS") {
    riskScore = 0.95;
    threatType = "IP_BLACKLIST";
    explanation = "Attempt to bypass strict IP restriction policies.";
  }

  const report: ThreatReport = {
    riskScore,
    confidence,
    threatType,
    isThreat: riskScore >= 0.7,
    source: "FALLBACK_RULE_ENGINE",
    details: explanation,
  };

  if (report.isThreat) {
    await logThreat(ipAddress, userEmail, action, report);
  }

  return report;
}

// Write the threat to the database and trigger security audit block
async function logThreat(
  ip: string,
  email: string | null,
  action: string,
  report: ThreatReport
) {
  try {
    await db.securityThreat.create({
      data: {
        ipAddress: ip,
        userEmail: email,
        action: action,
        threatType: report.threatType,
        riskScore: report.riskScore,
        confidence: report.confidence,
        status: "OPEN",
        details: `${report.source}: ${report.details}`,
      },
    });

    // Write a security alert to the immutable audit trail
    await writeAuditLog({
      action: "SECURITY_ALERT",
      userEmail: email,
      ipAddress: ip,
      details: {
        threatType: report.threatType,
        riskScore: report.riskScore,
        source: report.source,
      },
    });
  } catch (error) {
    console.error("Failed to write threat log:", error);
  }
}
