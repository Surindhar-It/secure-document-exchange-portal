import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import {
  verifySMSOTPHash,
  formatPhoneNumber,
} from "@/lib/textbee";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const identifier = (body.identifier || body.email || body.phone || "")?.trim();
    const otpCode = body.otpCode?.trim();

    if (!identifier || !otpCode) {
      return NextResponse.json(
        { error: "Account identifier and SMS verification code are required." },
        { status: 400 }
      );
    }

    const cleanLower = identifier.toLowerCase();
    const cleanPhone = formatPhoneNumber(identifier);

    // Look up user by Email OR Phone
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: cleanLower },
          { phoneNumber: cleanPhone },
        ],
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User account not found." }, { status: 404 });
    }

    // Find latest active OTP
    const activeOtp = await db.loginSmsOtp.findFirst({
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
      await db.loginSmsOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true },
      });
      return NextResponse.json(
        { error: "SMS verification code has expired after 5 minutes. Please request a new code." },
        { status: 400 }
      );
    }

    if (activeOtp.attempts >= activeOtp.maxAttempts) {
      await db.loginSmsOtp.update({
        where: { id: activeOtp.id },
        data: { isUsed: true },
      });
      return NextResponse.json(
        { error: "Maximum verification attempts exceeded. Code has been locked." },
        { status: 400 }
      );
    }

    const isValid = verifySMSOTPHash(otpCode, activeOtp.otpHash);

    if (!isValid) {
      const newAttempts = activeOtp.attempts + 1;
      const locked = newAttempts >= activeOtp.maxAttempts;
      await db.loginSmsOtp.update({
        where: { id: activeOtp.id },
        data: {
          attempts: newAttempts,
          isUsed: locked,
        },
      });

      return NextResponse.json(
        {
          error: locked
            ? "Too many incorrect attempts. This code is locked. Please request a new code."
            : `Incorrect verification code. ${activeOtp.maxAttempts - newAttempts} attempt(s) remaining.`,
        },
        { status: 400 }
      );
    }

    // Mark OTP as used
    await db.loginSmsOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true },
    });

    // Write audit log
    await writeAuditLog({
      action: "LOGIN_SUCCESS_SMS_OTP",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: { via: "TEXTBEE_SMS_OTP" },
    });

    // Sign JWT and set HTTP-only cookie
    const token = signJwtToken({ id: user.id, email: user.email });
    const response = NextResponse.json({
      success: true,
      message: "SMS OTP verified successfully. Welcome back!",
      user: { id: user.id, email: user.email, phoneNumber: user.phoneNumber, publicKey: user.publicKey },
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
    console.error("[Login:VerifyOTP] Error:", msg);
    return NextResponse.json({ error: "Failed to verify SMS verification code." }, { status: 500 });
  }
}
