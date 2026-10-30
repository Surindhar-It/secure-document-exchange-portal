import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import { verifyOTPHash } from "@/lib/email-otp";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const rawEmail = (body.email || "")?.trim();
    const otpCode = (body.otpCode || "")?.trim();

    if (!rawEmail || !otpCode) {
      return NextResponse.json(
        { error: "Recipient email and 6-digit verification code are required." },
        { status: 400 }
      );
    }

    const cleanEmail = rawEmail.toLowerCase();

    const user = await db.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user) {
      return NextResponse.json(
        { error: "No pending session found for this email address." },
        { status: 404 }
      );
    }

    // Find latest unused OTP
    const activeOtp = await db.loginEmailOtp.findFirst({
      where: {
        userId: user.id,
        isUsed: false,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeOtp) {
      return NextResponse.json(
        { error: "No active verification code found. Please request a new one." },
        { status: 400 }
      );
    }

    // Check expiration
    if (new Date() > new Date(activeOtp.expiresAt)) {
      await db.loginEmailOtp.update({ where: { id: activeOtp.id }, data: { isUsed: true } });
      return NextResponse.json(
        { error: "Verification code has expired. Please request a new code." },
        { status: 400 }
      );
    }

    // Check attempt limits
    if (activeOtp.attempts >= activeOtp.maxAttempts) {
      await db.loginEmailOtp.update({ where: { id: activeOtp.id }, data: { isUsed: true } });
      return NextResponse.json(
        { error: "Too many incorrect attempts. This code is locked. Please request a new code." },
        { status: 400 }
      );
    }

    // Verify hash
    const isValid = verifyOTPHash(otpCode, activeOtp.otpHash);
    if (!isValid) {
      const newAttempts = activeOtp.attempts + 1;
      const isLocked = newAttempts >= activeOtp.maxAttempts;
      await db.loginEmailOtp.update({
        where: { id: activeOtp.id },
        data: { attempts: newAttempts, isUsed: isLocked },
      });

      return NextResponse.json(
        {
          error: isLocked
            ? "Too many incorrect attempts. Code is locked. Please request a new code."
            : `Incorrect verification code. ${activeOtp.maxAttempts - newAttempts} attempt(s) remaining.`,
        },
        { status: 400 }
      );
    }

    // Mark OTP as used
    await db.loginEmailOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true },
    });

    // Write audit log
    await writeAuditLog({
      action: "RECOVERY_LOGIN_SUCCESS",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: { role: "RECIPIENT", portal: "RECOVERY_PORTAL" },
    });

    // Issue JWT Token with RECIPIENT role
    const token = signJwtToken({
      id: user.id,
      email: user.email,
      role: user.role || "RECIPIENT",
    });

    const response = NextResponse.json({
      success: true,
      message: "Recipient identity verified. Accessing Recovery Vault...",
      user: {
        id: user.id,
        email: user.email,
        role: user.role || "RECIPIENT",
      },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[RecoveryLogin:VerifyOTP] Error:", msg);
    return NextResponse.json(
      { error: "Failed to verify recovery code." },
      { status: 500 }
    );
  }
}
