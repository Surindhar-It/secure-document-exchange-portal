import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";

// GET: Retrieve all active share links created by the user
export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const links = await db.shareLink.findMany({
      where: { ownerId: sessionUser.id },
      include: {
        file: {
          select: {
            fileName: true,
            fileSize: true,
            mimeType: true,
            signature: true,
            createdAt: true,
          },
        },
        blockchainProofs: {
          select: {
            id: true,
            proofId: true,
            documentHash: true,
            eventType: true,
            status: true,
            network: true,
            txHash: true,
            blockNumber: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ links });
  } catch (error) {
    console.error("List links error:", error);
    return NextResponse.json({ error: "Failed to retrieve sharing links" }, { status: 500 });
  }
}

// POST: Update/Revoke a sharing link
export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { linkId, action } = body; // action: "revoke", "restore", "delete"

    if (!linkId) {
      return NextResponse.json({ error: "Link ID is required" }, { status: 400 });
    }

    const existingLink = await db.shareLink.findFirst({
      where: { id: linkId, ownerId: sessionUser.id },
      include: { file: true },
    });

    if (!existingLink) {
      return NextResponse.json({ error: "Link not found or unauthorized" }, { status: 404 });
    }

    if (action === "revoke") {
      const link = await db.shareLink.update({
        where: { id: linkId },
        data: { isRevoked: true, status: "REVOKED", revokedAt: new Date() },
      });

      await recordAuditEvent({
        action: "SHARE_REVOKED",
        userId: sessionUser.id,
        userEmail: sessionUser.email,
        ipAddress: ip,
        userAgent,
        transferMode: existingLink.transferMode as "STANDARD" | "BLOCKCHAIN",
        shareLinkId: linkId,
        fileId: existingLink.fileId,
        documentHash: existingLink.file?.signature || undefined,
        details: { shareLinkId: linkId, transferMode: existingLink.transferMode },
      });

      return NextResponse.json({ success: true, link });
    }

    if (action === "restore") {
      const link = await db.shareLink.update({
        where: { id: linkId },
        data: { isRevoked: false, status: "ACTIVE", revokedAt: null },
      });

      await recordAuditEvent({
        action: "LINK_RESTORE",
        userId: sessionUser.id,
        userEmail: sessionUser.email,
        ipAddress: ip,
        userAgent,
        transferMode: existingLink.transferMode as "STANDARD" | "BLOCKCHAIN",
        shareLinkId: linkId,
        fileId: existingLink.fileId,
        documentHash: existingLink.file?.signature || undefined,
        details: { shareLinkId: linkId },
      });

      return NextResponse.json({ success: true, link });
    }

    if (action === "delete") {
      await db.shareLink.delete({
        where: { id: linkId },
      });

      await recordAuditEvent({
        action: "LINK_DELETE",
        userId: sessionUser.id,
        userEmail: sessionUser.email,
        ipAddress: ip,
        userAgent,
        details: { shareLinkId: linkId },
      });

      return NextResponse.json({ success: true, message: "Link deleted successfully" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Link update error:", error);
    return NextResponse.json({ error: "Failed to update link" }, { status: 500 });
  }
}
