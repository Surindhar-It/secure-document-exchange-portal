import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const userEmail = sessionUser.email.toLowerCase().trim();

    // Query active and historical transfers assigned to this recipient email
    const rawLinks = await db.shareLink.findMany({
      where: {
        recipientEmail: {
          equals: userEmail,
          mode: "insensitive",
        },
      },
      include: {
        owner: {
          select: {
            email: true,
          },
        },
        file: {
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
        },
        files: {
          include: {
            file: {
              select: {
                id: true,
                fileName: true,
                fileSize: true,
                mimeType: true,
                createdAt: true,
              },
            },
          },
        },
      },
      orderBy: { expiresAt: "desc" },
    });

    const now = new Date();

    const transfers = rawLinks.map((link) => {
      // Collect bundled or single files
      const bundledFiles = link.files && link.files.length > 0
        ? link.files.map((bf) => bf.file).filter(Boolean)
        : link.file ? [link.file] : [];

      const isExpired = link.expiresAt ? new Date(link.expiresAt) < now : false;
      const isMaxReached = link.maxDownloads ? link.downloadCount >= link.maxDownloads : false;

      let computedStatus = link.status;
      if (link.isRevoked) {
        computedStatus = "REVOKED";
      } else if (isExpired) {
        computedStatus = "EXPIRED";
      } else if (isMaxReached) {
        computedStatus = "LIMIT_REACHED";
      }

      return {
        id: link.id,
        transferMode: link.transferMode,
        senderEmail: link.owner?.email || "Unknown Sender",
        status: computedStatus,
        authMethod: link.authMethod,
        hasPassword: !!link.passwordHash,
        otpEnabled: link.otpEnabled,
        downloadCount: link.downloadCount,
        maxDownloads: link.maxDownloads,
        expiresAt: link.expiresAt,
        isExpired,
        isRevoked: link.isRevoked,
        stegoEnabled: link.stegoEnabled,
        files: bundledFiles,
        fileCount: bundledFiles.length,
      };
    });

    return NextResponse.json({
      success: true,
      transfers,
      recipientEmail: sessionUser.email,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Recovery:MyTransfers] Error:", msg);
    return NextResponse.json(
      { error: "Failed to load recipient transfers." },
      { status: 500 }
    );
  }
}
