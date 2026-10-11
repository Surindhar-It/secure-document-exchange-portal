import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit";
import { getSystemNetworkIp } from "@/lib/security";

export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const verify = searchParams.get("verify") === "true";

  try {
    // 1. If verification is requested, check the integrity of the hash chain
    let verificationResult = null;
    if (verify) {
      verificationResult = await verifyAuditChain();
    }

    // 2. Fetch logs (limit to last 100 for display performance)
    const logs = await db.auditLog.findMany({
      orderBy: { index: "desc" },
      take: 100,
    });

    // Pre-fetch FILE_UPLOAD logs to map fileId to uploader's (sender's) IP address
    const uploadLogs = await db.auditLog.findMany({
      where: { action: "FILE_UPLOAD" }
    });

    const fileToIpMap = new Map<string, string>();
    for (const upload of uploadLogs) {
      try {
        const details = JSON.parse(upload.details || "{}");
        if (details.fileId) {
          fileToIpMap.set(details.fileId, upload.ipAddress || "unknown");
        }
      } catch (e) {}
    }

    const serverIp = getSystemNetworkIp();

    // Enrich logs with sender and receiver IP info
    const enrichedLogs = logs.map((log) => {
      let senderIp = "n/a";
      let receiverIp = "n/a";

      if (log.action === "FILE_UPLOAD") {
        senderIp = log.ipAddress || "unknown";
        receiverIp = serverIp;
      } else if (log.action === "DOWNLOAD") {
        let fileId = "";
        try {
          const details = JSON.parse(log.details || "{}");
          fileId = details.fileId || "";
        } catch (e) {}

        senderIp = fileToIpMap.get(fileId) || "unknown";
        receiverIp = log.ipAddress || "unknown";
      } else {
        // General actions (login, setup, etc.)
        senderIp = log.ipAddress || "n/a";
        receiverIp = serverIp;
      }

      // Convert any loopback IPs to actual system IP
      if (senderIp === "::1" || senderIp === "127.0.0.1" || senderIp === "localhost") {
        senderIp = serverIp;
      }
      if (receiverIp === "::1" || receiverIp === "127.0.0.1" || receiverIp === "localhost") {
        receiverIp = serverIp;
      }

      return {
        ...log,
        senderIp,
        receiverIp,
      };
    });

    return NextResponse.json({
      success: true,
      logs: enrichedLogs,
      verification: verificationResult,
    });
  } catch (error) {
    console.error("Audit fetch error:", error);
    return NextResponse.json({ error: "Failed to retrieve audit logs" }, { status: 500 });
  }
}
