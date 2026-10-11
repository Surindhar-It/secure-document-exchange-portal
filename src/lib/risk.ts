/**
 * RiskEngine: Transparent rule-based security scoring for document access.
 * Calculates dynamic risk scores (0 to 100) and maps to access policy actions.
 */

export interface RiskEvaluationInput {
  ipAddress: string;
  userEmail?: string | null;
  recipientEmail?: string | null;
  claimedEmail?: string | null;
  linkId: string;
  geoCountry?: string | null;
  allowedGeos?: string | null;
  failedAttemptsCount?: number;
  recentDownloadsInHour?: number;
  isNewDevice?: boolean;
}

export interface RiskAssessment {
  score: number; // 0 to 100
  level: "LOW" | "MEDIUM" | "HIGH";
  action: "ALLOW" | "REQUIRE_MFA" | "BLOCK_AND_FREEZE";
  factors: string[];
  explanation: string;
}

export function evaluateRisk(input: RiskEvaluationInput): RiskAssessment {
  let score = 0;
  const factors: string[] = [];

  // Factor 1: Device Trust
  if (input.isNewDevice) {
    score += 30;
    factors.push("Unrecognized or new client device (+30)");
  }

  // Factor 2: Recipient Verification
  if (input.recipientEmail && input.claimedEmail) {
    if (input.recipientEmail.toLowerCase().trim() !== input.claimedEmail.toLowerCase().trim()) {
      score += 40;
      factors.push(`Recipient mismatch: link bound to ${input.recipientEmail}, accessed by ${input.claimedEmail} (+40)`);
    }
  }

  // Factor 3: Geographic Anomaly
  if (input.allowedGeos && input.geoCountry) {
    const allowed = input.allowedGeos.split(",").map((g) => g.trim().toUpperCase());
    if (!allowed.includes(input.geoCountry.toUpperCase())) {
      score += 25;
      factors.push(`Geographic anomaly: location ${input.geoCountry} not in permitted zones (+25)`);
    }
  }

  // Factor 4: Failed Authentication History (Password/OTP)
  const failedAttempts = input.failedAttemptsCount || 0;
  if (failedAttempts >= 4) {
    score += 35;
    factors.push(`Repeated authentication failures (${failedAttempts} attempts) (+35)`);
  } else if (failedAttempts >= 2) {
    score += 20;
    factors.push(`Elevated failed attempts (${failedAttempts} attempts) (+20)`);
  }

  // Factor 5: Rapid Download Spikes (Potential Data Exfiltration)
  const recentDownloads = input.recentDownloadsInHour || 0;
  if (recentDownloads >= 15) {
    score += 35;
    factors.push(`High download frequency detected (${recentDownloads} in past hour) (+35)`);
  } else if (recentDownloads >= 8) {
    score += 20;
    factors.push(`Elevated download rate (${recentDownloads} in past hour) (+20)`);
  }

  // Factor 6: Access Time check (Optional flag outside standard business hours)
  const currentHour = new Date().getUTCHours();
  if (currentHour >= 1 && currentHour <= 4) {
    score += 10;
    factors.push("Access during low-traffic overnight window UTC (+10)");
  }

  // Normalize score between 0 and 100
  score = Math.min(100, Math.max(0, score));

  // Determine Level and Action
  let level: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  let action: "ALLOW" | "REQUIRE_MFA" | "BLOCK_AND_FREEZE" = "ALLOW";

  if (score >= 61) {
    level = "HIGH";
    action = "BLOCK_AND_FREEZE";
  } else if (score >= 31) {
    level = "MEDIUM";
    action = "REQUIRE_MFA";
  } else {
    level = "LOW";
    action = "ALLOW";
  }

  const explanation =
    factors.length > 0
      ? `Risk evaluation completed (${score}/100 - ${level}): ${factors.join("; ")}`
      : "Access parameters conform to normal baseline profile (Score: 0/100 - LOW).";

  return {
    score,
    level,
    action,
    factors,
    explanation,
  };
}
