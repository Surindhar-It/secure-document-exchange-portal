import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Summary Metrics from real database tables
    const [
      totalUsers,
      totalDocuments,
      activeTransfers,
      standardTransfers,
      blockchainTransfers,
      successfulDownloads,
      deniedAttempts,
      expiredTransfers,
      revokedTransfers,
      pendingProofs,
      failedProofs,
      confirmedProofs,
      storageAggregate,
      securityThreatCount,
    ] = await Promise.all([
      db.user.count(),
      db.fileMetadata.count(),
      db.shareLink.count({
        where: {
          isRevoked: false,
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      db.shareLink.count({ where: { transferMode: "STANDARD" } }),
      db.shareLink.count({ where: { transferMode: "BLOCKCHAIN" } }),
      db.auditLog.count({ where: { action: "DOWNLOAD_COMPLETED" } }),
      db.auditLog.count({
        where: {
          action: {
            in: [
              "LINK_ACCESS_FAIL",
              "DOWNLOAD_DENIED",
              "HIGH_RISK_BLOCK",
              "LOGIN_FAIL",
              "MFA_VERIFY_FAIL",
            ],
          },
        },
      }),
      db.shareLink.count({
        where: {
          OR: [
            { status: "EXPIRED" },
            { expiresAt: { lt: now } },
          ],
        },
      }),
      db.shareLink.count({
        where: {
          OR: [{ isRevoked: true }, { status: "REVOKED" }],
        },
      }),
      db.blockchainProof.count({ where: { status: "PENDING" } }),
      db.blockchainProof.count({ where: { status: "FAILED" } }),
      db.blockchainProof.count({
        where: { status: { in: ["CONFIRMED", "VERIFIED"] } },
      }),
      db.fileMetadata.aggregate({
        _sum: { fileSize: true },
      }),
      db.securityThreat.count(),
    ]);

    // Active users: Distinct user emails appearing in AuditLog in the last 30 days
    const recentActiveLogs = await db.auditLog.findMany({
      where: {
        timestamp: { gte: thirtyDaysAgo },
        userEmail: { not: null },
      },
      select: { userEmail: true },
      distinct: ["userEmail"],
    });
    const activeUsers = Math.max(recentActiveLogs.length, 1);

    const totalEncryptedStorageBytes = storageAggregate._sum.fileSize || 0;

    // 2. Six-Month Upload and Download Trends
    const monthTrends: {
      monthKey: string;
      label: string;
      uploads: number;
      downloads: number;
    }[] = [];

    for (let i = 5; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      const monthLabel = startOfMonth.toLocaleString("default", { month: "short", year: "2-digit" });

      const [monthUploads, monthDownloads] = await Promise.all([
        db.auditLog.count({
          where: {
            action: { in: ["FILE_UPLOAD", "DOCUMENT_ENCRYPTION"] },
            timestamp: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
        db.auditLog.count({
          where: {
            action: "DOWNLOAD_COMPLETED",
            timestamp: { gte: startOfMonth, lte: endOfMonth },
          },
        }),
      ]);

      monthTrends.push({
        monthKey: `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth() + 1).padStart(2, "0")}`,
        label: monthLabel,
        uploads: monthUploads,
        downloads: monthDownloads,
      });
    }

    // 3. Document Storage Distribution (Categorized by MIME type)
    const allFiles = await db.fileMetadata.findMany({
      select: { mimeType: true, fileSize: true },
    });

    const storageCategories: Record<string, { count: number; totalBytes: number }> = {
      PDF: { count: 0, totalBytes: 0 },
      Images: { count: 0, totalBytes: 0 },
      Documents: { count: 0, totalBytes: 0 },
      Archives: { count: 0, totalBytes: 0 },
      Binary: { count: 0, totalBytes: 0 },
    };

    allFiles.forEach((f) => {
      const mime = f.mimeType.toLowerCase();
      let cat = "Binary";
      if (mime.includes("pdf")) cat = "PDF";
      else if (mime.includes("image")) cat = "Images";
      else if (mime.includes("word") || mime.includes("text") || mime.includes("excel") || mime.includes("spreadsheet")) cat = "Documents";
      else if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("7z")) cat = "Archives";

      storageCategories[cat].count += 1;
      storageCategories[cat].totalBytes += f.fileSize;
    });

    const storageDistribution = Object.entries(storageCategories).map(([category, stats]) => ({
      category,
      count: stats.count,
      totalBytes: stats.totalBytes,
      percentage: totalEncryptedStorageBytes > 0
        ? Math.round((stats.totalBytes / totalEncryptedStorageBytes) * 100)
        : 0,
    }));

    // 4. Daily Security Event Trends (Past 7 Days)
    const dailySecurityEvents: { date: string; normal: number; security: number }[] = [];
    for (let d = 6; d >= 0; d--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 0, 0, 0);
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 23, 59, 59, 999);
      const dayLabel = dayStart.toLocaleDateString("default", { weekday: "short" });

      const [normalOps, securityOps] = await Promise.all([
        db.auditLog.count({
          where: {
            action: { in: ["FILE_UPLOAD", "SHARE_CREATED", "DOWNLOAD_COMPLETED"] },
            timestamp: { gte: dayStart, lte: dayEnd },
          },
        }),
        db.auditLog.count({
          where: {
            action: {
              in: [
                "LINK_ACCESS_FAIL",
                "HIGH_RISK_BLOCK",
                "LOGIN_FAIL",
                "GEO_MISMATCH",
                "RATE_LIMIT_EXCEEDED",
              ],
            },
            timestamp: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);

      dailySecurityEvents.push({
        date: dayLabel,
        normal: normalOps,
        security: securityOps,
      });
    }

    // 5. Operation-Wise Comparison
    const [
      opUploads,
      opShares,
      opDownloads,
      opRevokes,
      opAlerts,
    ] = await Promise.all([
      db.auditLog.count({ where: { action: { in: ["FILE_UPLOAD", "DOCUMENT_ENCRYPTION"] } } }),
      db.auditLog.count({ where: { action: "SHARE_CREATED" } }),
      db.auditLog.count({ where: { action: "DOWNLOAD_COMPLETED" } }),
      db.auditLog.count({ where: { action: "SHARE_REVOKED" } }),
      db.auditLog.count({
        where: {
          action: { in: ["LINK_ACCESS_FAIL", "HIGH_RISK_BLOCK", "GEO_MISMATCH"] },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      summary: {
        totalUsers,
        activeUsers,
        totalDocuments,
        encryptedDocuments: totalDocuments, // All documents encrypted AES-256-GCM
        activeTransfers,
        standardTransfers,
        blockchainTransfers,
        successfulDownloads,
        deniedAccessAttempts: deniedAttempts,
        expiredTransfers,
        revokedTransfers,
        pendingBlockchainProofs: pendingProofs,
        failedBlockchainProofs: failedProofs,
        confirmedBlockchainProofs: confirmedProofs,
        totalEncryptedStorageBytes,
        securityAlerts: securityThreatCount,
      },
      charts: {
        sixMonthTrends: monthTrends,
        transferModeDistribution: {
          standard: standardTransfers,
          blockchain: blockchainTransfers,
          total: standardTransfers + blockchainTransfers,
        },
        storageDistribution,
        accessRatio: {
          successful: successfulDownloads,
          denied: deniedAttempts,
          total: successfulDownloads + deniedAttempts,
        },
        dailySecurityEvents,
        proofStatusDistribution: {
          confirmed: confirmedProofs,
          pending: pendingProofs,
          failed: failedProofs,
        },
        operationComparison: [
          { name: "Uploads", count: opUploads, color: "#6366f1" },
          { name: "Transfers Created", count: opShares, color: "#3b82f6" },
          { name: "Downloads", count: opDownloads, color: "#10b981" },
          { name: "Revocations", count: opRevokes, color: "#f59e0b" },
          { name: "Security Alerts", count: opAlerts, color: "#f43f5e" },
        ],
      },
    });
  } catch (error) {
    console.error("Admin analytics error:", error);
    return NextResponse.json({ error: "Failed to generate analytics telemetry" }, { status: 500 });
  }
}
