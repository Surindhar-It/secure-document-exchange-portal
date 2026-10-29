import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { resetToken, newPassword } = body;

    if (!resetToken || typeof resetToken !== "string" || resetToken.length < 32) {
      return NextResponse.json(
        { error: "Invalid or expired password reset session." },
        { status: 400 }
      );
    }

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    // Find the OTP record matching the resetToken
    const otpRecord = await db.passwordResetOtp.findFirst({
      where: { resetToken },
      include: { user: true },
    });

    if (!otpRecord || !otpRecord.user) {
      return NextResponse.json(
        { error: "Invalid reset session token. Please initiate a new password reset." },
        { status: 403 }
      );
    }

    // Reset tokens are valid for 15 minutes from creation
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (otpRecord.createdAt < fifteenMinutesAgo) {
      return NextResponse.json(
        { error: "Password reset session has expired after 15 minutes. Please request a new SMS OTP." },
        { status: 403 }
      );
    }

    // Hash the new password with bcrypt (10 rounds)
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update the user's password and clear the reset token
    await db.user.update({
      where: { id: otpRecord.userId },
      data: { passwordHash: newPasswordHash },
    });

    await db.passwordResetOtp.update({
      where: { id: otpRecord.id },
      data: { resetToken: null },
    });

    await recordAuditEvent({
      action: "PASSWORD_RESET_SUCCESS",
      userId: otpRecord.userId,
      userEmail: otpRecord.user.email,
      ipAddress: ip,
      userAgent,
      details: {
        resetVia: "TEXTBEE_SMS_OTP",
        phoneNumber: otpRecord.phoneNumber,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Password reset successfully! You can now sign in with your new password.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ForgotPassword:Reset] Error:", msg);
    return NextResponse.json({ error: "Failed to reset password." }, { status: 500 });
  }
}
