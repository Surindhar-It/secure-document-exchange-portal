import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import { formatPhoneNumber } from "@/lib/textbee";
import { generateOTP, hashOTP, maskEmail, sendLoginEmailOTP } from "@/lib/email-otp";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");
  
  try {
    const body = await req.json();
    const identifier = (body.identifier || body.email || "")?.trim();
    const { password } = body;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Email or mobile phone number and password are required" },
        { status: 400 }
      );
    }

    // AI Threat Engine check for IP
    const threatCheck = await evaluateAccessThreat({
      ipAddress: ip,
      userEmail: identifier,
      action: "LOGIN_CHECK",
      details: { identifier }
    });

    if (threatCheck.isThreat && threatCheck.threatType === "BRUTE_FORCE") {
      return NextResponse.json({
        error: "Access blocked due to suspicious login anomalies. Please try again later.",
        threatType: threatCheck.threatType,
        details: threatCheck.details
      }, { status: 403 });
    }

    const cleanLower = identifier.toLowerCase();
    const cleanPhone = formatPhoneNumber(identifier);

    // Look up user by either Email OR Phone Number
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: cleanLower },
          { phoneNumber: cleanPhone },
        ],
      },
    });

    if (!user) {
      // Log failure in hash chain
      await writeAuditLog({
        action: "LOGIN_FAIL",
        userEmail: identifier,
        ipAddress: ip,
        userAgent,
        details: { reason: "User not found" },
      });

      // Assess anomaly
      await evaluateAccessThreat({ ipAddress: ip, userEmail: identifier, action: "LOGIN_FAIL" });

      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }


    // Verify Password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      // Log failure in hash chain
      await writeAuditLog({
        action: "LOGIN_FAIL",
        userId: user.id,
        userEmail: user.email,
        ipAddress: ip,
        userAgent,
        details: { reason: "Password mismatch" },
      });

      // Assess anomaly
      await evaluateAccessThreat({ ipAddress: ip, userEmail: user.email, action: "LOGIN_FAIL" });

      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Password is valid! Enforce Email OTP for every login
    const plainOtp = generateOTP();
    const otpHash = hashOTP(plainOtp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Invalidate prior unused login OTPs for this user
    await db.loginEmailOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    // Store new login OTP record
    await db.loginEmailOtp.create({
      data: {
        userId: user.id,
        email: user.email,
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      },
    });

    // Send OTP to user's registered email address
    const emailResult = await sendLoginEmailOTP(user.email, plainOtp);

    await writeAuditLog({
      action: "LOGIN_OTP_SENT",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: {
        email: maskEmail(user.email),
        simulated: emailResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      otpRequired: true,
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      message: `Password verified. A 6-digit verification code has been sent to your email (${maskEmail(user.email)}).`,
      simulated: emailResult.simulated,
      devCode: emailResult.simulated ? plainOtp : undefined,
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "An internal server error occurred" }, { status: 500 });
  }
}
