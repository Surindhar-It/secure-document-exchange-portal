import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import {
  verifySMSOTPHash,
  generateResetSessionToken,
  formatPhoneNumber,
} from "@/lib/textbee";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { identifier, otpCode } = body;

    if (!identifier || !otpCode) {
      return NextResponse.json(
        { error: "Account identifier and verification code are required." },
        { status: 400 }
      );
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: cleanIdentifier },
          { phoneNumber: formatPhoneNumber(cleanIdentifier) },
        ],
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User account not found." }, { status: 404 });
    }

    const activeOtp = await db.passwordResetOtp.findFirst({
      where: {
        userId: user.id,
        isUsed: false,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeOtp) {
      return NextResponse.json(
        { error: "No active verification code found. Please request a new code." },
        { status: 400 }
      );
    }

    const now = new Date();
    if (now > activeOtp.expiresAt) {
      await db.passwordResetOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true },
      });
      return NextResponse.json(
        { error: "Verification code has expired. Please request a fresh code." },
        { status: 400 }
      );
    }

    if (activeOtp.attempts >= activeOtp.maxAttempts) {
      await db.passwordResetOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true },
      });
      return NextResponse.json(
        { error: "Maximum attempts exceeded. This code is locked. Please request a new code." },
        { status: 400 }
      );
    }

    const isValid = verifySMSOTPHash(otpCode.trim(), activeOtp.otpHash);

    if (!isValid) {
      const newAttempts = activeOtp.attempts + 1;
      const locked = newAttempts >= activeOtp.maxAttempts;
      await db.passwordResetOtp.update({
        where: { id: activeOtp.id },
        data: {
          attempts: newAttempts,
          isUsed: locked,
        },
      });

      return NextResponse.json(
        {
          error: locked
            ? "Too many incorrect attempts. Code locked. Request a new code."
            : `Incorrect code. ${activeOtp.maxAttempts - newAttempts} attempt(s) remaining.`,
        },
        { status: 400 }
      );
    }

    // Code is valid! Issue high-entropy reset session token
    const resetToken = generateResetSessionToken();

    await db.passwordResetOtp.update({
      where: { id: activeOtp.id },
      data: {
        isUsed: true,
        resetToken,
      },
    });

    await recordAuditEvent({
      action: "PASSWORD_RESET_OTP_VERIFIED",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: {
        maskedPhone: activeOtp.phoneNumber,
      },
    });

    return NextResponse.json({
      success: true,
      resetToken,
      message: "SMS OTP verified successfully. You may now enter your new password.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ForgotPassword:VerifyOTP] Error:", msg);
    return NextResponse.json({ error: "Failed to verify SMS code." }, { status: 500 });
  }
}
