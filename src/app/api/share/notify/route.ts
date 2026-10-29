import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import { decryptSecret } from "@/lib/kms";
import { sendShareNotificationEmail, EmailDeliveryMode } from "@/lib/email-service";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { shareLinkId, deliveryMode } = body;

    if (!shareLinkId || typeof shareLinkId !== "string") {
      return NextResponse.json(
        { error: "shareLinkId is required" },
        { status: 400 }
      );
    }

    // Verify ownership and load link with files
    const shareLink = await db.shareLink.findUnique({
      where: { id: shareLinkId },
      include: {
        files: {
          include: { file: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!shareLink || shareLink.ownerId !== sessionUser.id) {
      return NextResponse.json(
        { error: "Share link not found or access denied" },
        { status: 404 }
      );
    }

    if (shareLink.isRevoked || shareLink.status === "REVOKED") {
      return NextResponse.json(
        { error: "Cannot send notification: This share link has been revoked" },
        { status: 400 }
      );
    }

    if (shareLink.expiresAt && new Date() > shareLink.expiresAt) {
      return NextResponse.json(
        { error: "Cannot send notification: This share link has expired" },
        { status: 400 }
      );
    }

    if (!shareLink.recipientEmail) {
      return NextResponse.json(
        { error: "No recipient email address is associated with this transfer link" },
        { status: 400 }
      );
    }

    // Recover download password safely using KMS backend decryption if present
    let decryptedPassword: string | null = null;
    if (shareLink.encryptedPassword) {
      try {
        decryptedPassword = decryptSecret(shareLink.encryptedPassword);
      } catch (decErr) {
        console.error("[ShareNotify] Failed to decrypt password envelope:", decErr);
      }
    }

    const effectiveDeliveryMode: EmailDeliveryMode =
      (deliveryMode as EmailDeliveryMode) ||
      (shareLink.emailDeliveryMode as EmailDeliveryMode) ||
      (decryptedPassword ? "SEPARATE" : "LINK_ONLY");

    const reqHeaders = req.headers;
    const host =
      reqHeaders.get("x-forwarded-host") ||
      reqHeaders.get("host") ||
      "localhost:3000";
    const proto = reqHeaders.get("x-forwarded-proto") || "http";
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
    const shareUrl = `${baseUrl.replace(/\/$/, "")}/download/${shareLink.id}`;

    const fileNames = shareLink.files.map((sf) => sf.file.fileName);

    const dispatchResult = await sendShareNotificationEmail({
      recipientEmail: shareLink.recipientEmail,
      senderEmail: sessionUser.email,
      shareUrl,
      shareLinkId: shareLink.id,
      fileNames,
      fileCount: shareLink.files.length,
      password: decryptedPassword,
      authMethod: shareLink.authMethod,
      transferMode: shareLink.transferMode as "STANDARD" | "BLOCKCHAIN",
      expiresAt: shareLink.expiresAt,
      maxDownloads: shareLink.maxDownloads,
      deliveryMode: effectiveDeliveryMode,
      clientIp: ip,
    });

    if (!dispatchResult.success && !dispatchResult.simulated) {
      return NextResponse.json(
        {
          error:
            dispatchResult.error ||
            "Failed to send email notification to recipient",
        },
        { status: 502 }
      );
    }

    // Update status in DB
    await db.shareLink.update({
      where: { id: shareLink.id },
      data: {
        emailNotificationSent: true,
        emailDeliveryMode: dispatchResult.deliveryMode,
      },
    });

    await recordAuditEvent({
      action: "SHARE_EMAIL_RESENT",
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      ipAddress: ip,
      userAgent,
      transferMode: shareLink.transferMode as "STANDARD" | "BLOCKCHAIN",
      shareLinkId: shareLink.id,
      details: {
        shareLinkId: shareLink.id,
        recipientEmail: shareLink.recipientEmail,
        deliveryMode: dispatchResult.deliveryMode,
        messagesSent: dispatchResult.messagesSent,
        simulated: dispatchResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      message: dispatchResult.simulated
        ? `Notification simulated (${dispatchResult.deliveryMode === "SEPARATE" ? "2 emails" : "1 email"}) to ${shareLink.recipientEmail}.`
        : `Email notification sent successfully (${dispatchResult.deliveryMode === "SEPARATE" ? "Link & Password sent in separate emails" : "Link email dispatched"}) to ${shareLink.recipientEmail}.`,
      deliveryMode: dispatchResult.deliveryMode,
      messagesSent: dispatchResult.messagesSent,
      simulated: dispatchResult.simulated,
    });
  } catch (error) {
    console.error("[ShareNotify] Error:", error);
    return NextResponse.json(
      { error: "Internal server error while dispatching email notification" },
      { status: 500 }
    );
  }
}
