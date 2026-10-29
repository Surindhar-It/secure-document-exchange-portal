import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveClientIp } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";
import { decryptSecretToken } from "@/lib/kms";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { shareLinkId, cipherToken } = body;

    if (!shareLinkId || typeof shareLinkId !== "string") {
      return NextResponse.json(
        { error: "Share Link ID is required." },
        { status: 400 }
      );
    }

    const shareLink = await db.shareLink.findUnique({
      where: { id: shareLinkId.trim() },
    });

    if (!shareLink) {
      return NextResponse.json(
        { error: "Transfer link not found or invalid." },
        { status: 404 }
      );
    }

    if (shareLink.isRevoked || shareLink.status === "REVOKED") {
      return NextResponse.json(
        { error: "This transfer link has been revoked by the owner." },
        { status: 403 }
      );
    }

    if (shareLink.expiresAt && new Date() > shareLink.expiresAt) {
      return NextResponse.json(
        { error: "This transfer link has expired." },
        { status: 410 }
      );
    }

    if (!shareLink.encryptedPassword) {
      return NextResponse.json(
        { error: "No password protection is configured for this transfer." },
        { status: 400 }
      );
    }

    // Decrypt using KMS
    const tokenToDecrypt = cipherToken && typeof cipherToken === "string" && cipherToken.trim().length > 0
      ? cipherToken.trim()
      : shareLink.encryptedPassword;

    let decryptedPassword = "";
    try {
      decryptedPassword = decryptSecretToken(tokenToDecrypt);
    } catch (decErr) {
      // If user passed custom token that failed, fallback to decrypting link's stored package
      try {
        decryptedPassword = decryptSecretToken(shareLink.encryptedPassword);
      } catch (innerErr) {
        return NextResponse.json(
          { error: "Unable to decrypt cipher token. Invalid key or corrupted payload." },
          { status: 400 }
        );
      }
    }

    // Verify against passwordHash if hash is present
    if (shareLink.passwordHash) {
      const match = await bcrypt.compare(decryptedPassword, shareLink.passwordHash);
      if (!match) {
        return NextResponse.json(
          { error: "Decrypted password verification failed against integrity hash." },
          { status: 400 }
        );
      }
    }

    await writeAuditLog({
      action: "PASSWORD_DECRYPTED_RECOVERY",
      userEmail: shareLink.recipientEmail || "anonymous_recipient",
      ipAddress: ip,
      userAgent,
      details: {
        shareLinkId: shareLink.id,
        transferMode: shareLink.transferMode,
      },
    });

    return NextResponse.json({
      success: true,
      decryptedPassword,
      shareLinkId: shareLink.id,
      message: "Password decrypted successfully via KMS zero-knowledge envelope.",
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[DecryptPassword API Error]:", msg);
    return NextResponse.json(
      { error: "Internal server error decrypting password." },
      { status: 500 }
    );
  }
}
