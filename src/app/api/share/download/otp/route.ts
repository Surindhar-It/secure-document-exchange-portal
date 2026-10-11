import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { id: linkId } = body;

    if (!linkId) {
      return NextResponse.json({ error: "Share Link ID is required" }, { status: 400 });
    }

    const link = await db.shareLink.findUnique({
      where: { id: linkId },
    });

    if (!link || link.isRevoked) {
      return NextResponse.json({ error: "Sharing link is invalid or has been revoked" }, { status: 404 });
    }

    if (!link.otpEnabled) {
      return NextResponse.json({ error: "OTP is not enabled for this share link" }, { status: 400 });
    }

    // Generate a 6-digit numeric passcode
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store the passcode in the otpSecret field for verification
    await db.shareLink.update({
      where: { id: linkId },
      data: { otpSecret: otpCode },
    });

    // Log the OTP request in our audit ledger
    await writeAuditLog({
      action: "LINK_OTP_REQUEST",
      ipAddress: ip,
      userAgent,
      details: { linkId },
    });

    // In a production app, we would send this via SMS/Email.
    // For our secure cyber-portal demo, we return it to the user so it can be shown in a visual mock alert.
    return NextResponse.json({
      success: true,
      otpCode,
      message: "A verification code has been dispatched. Enter the 6-digit code below to unlock the file decryption key.",
    });
  } catch (error) {
    console.error("OTP generation error:", error);
    return NextResponse.json({ error: "Failed to generate security code" }, { status: 500 });
  }
}
