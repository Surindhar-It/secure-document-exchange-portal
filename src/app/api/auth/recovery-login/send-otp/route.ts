import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";
import { generateOTP, hashOTP, maskEmail, sendLoginEmailOTP } from "@/lib/email-otp";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const rawEmail = (body.email || "")?.trim();

    if (!rawEmail || !rawEmail.includes("@")) {
      return NextResponse.json(
        { error: "A valid recipient email address is required." },
        { status: 400 }
      );
    }

    const cleanEmail = rawEmail.toLowerCase();

    // AI Threat evaluation
    const threatCheck = await evaluateAccessThreat({
      ipAddress: ip,
      userEmail: cleanEmail,
      action: "RECOVERY_LOGIN_OTP_REQUEST",
      details: { email: cleanEmail },
    });

    if (threatCheck.isThreat && threatCheck.threatType === "BRUTE_FORCE") {
      return NextResponse.json(
        {
          error: "Rate limit triggered. Please wait a few moments before requesting another code.",
        },
        { status: 429 }
      );
    }

    // Check if user exists; if not, create a RECIPIENT role record
    let user = await db.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user) {
      const ephemeralSalt = await crypto.randomBytes(16).toString("hex");
      user = await db.user.create({
        data: {
          email: cleanEmail,
          passwordHash: `RECIPIENT_PASSWORDLESS_${ephemeralSalt}`,
          role: "RECIPIENT",
        },
      });
    }

    // Invalidate prior unused OTPs for this user
    await db.loginEmailOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    // Generate 6-digit cryptographically secure OTP
    const rawOtp = generateOTP();
    const otpHash = hashOTP(rawOtp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store in DB
    await db.loginEmailOtp.create({
      data: {
        userId: user.id,
        email: cleanEmail,
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      },
    });

    // Dispatch OTP via Brevo / SMTP / Resend cascade
    const emailResult = await sendLoginEmailOTP(cleanEmail, rawOtp);

    await writeAuditLog({
      action: "RECOVERY_OTP_SENT",
      userId: user.id,
      userEmail: cleanEmail,
      ipAddress: ip,
      userAgent,
      details: {
        deliverySuccess: emailResult.success,
        simulated: emailResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Verification code dispatched to ${maskEmail(cleanEmail)}.`,
      maskedEmail: maskEmail(cleanEmail),
      expiresIn: 300,
      devCode: process.env.NODE_ENV !== "production" || emailResult.simulated ? rawOtp : null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[RecoveryLogin:SendOTP] Error:", msg);
    return NextResponse.json(
      { error: "Failed to dispatch recovery verification code. Please try again." },
      { status: 500 }
    );
  }
}
