import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import {
  generateSMSOTP,
  hashSMSOTP,
  maskPhoneNumber,
  formatPhoneNumber,
  sendTextBeeSMS,
} from "@/lib/textbee";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const identifier = (body.identifier || body.email || body.phone || "")?.trim();

    if (!identifier) {
      return NextResponse.json(
        { error: "Please enter your registered email address or mobile phone number." },
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
      await writeAuditLog({
        action: "LOGIN_FAIL",
        userEmail: identifier,
        ipAddress: ip,
        userAgent,
        details: { reason: "User not found for SMS OTP login" },
      });
      return NextResponse.json(
        { error: "No account found matching this email or phone number." },
        { status: 404 }
      );
    }

    if (!user.phoneNumber) {
      return NextResponse.json(
        { error: "No mobile phone number is linked to this account for SMS OTP login." },
        { status: 400 }
      );
    }

    // Cooldown check: 60 seconds from previous OTP
    const latestOtp = await db.loginSmsOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    if (latestOtp && now.getTime() - latestOtp.createdAt.getTime() < 60000) {
      const waitSeconds = Math.ceil((60000 - (now.getTime() - latestOtp.createdAt.getTime())) / 1000);
      return NextResponse.json(
        { error: `Please wait ${waitSeconds}s before requesting a new login SMS code.` },
        { status: 429 }
      );
    }

    // Invalidate existing unused login OTPs
    await db.loginSmsOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    // Generate 6-digit OTP
    const plainOtp = generateSMSOTP();
    const otpHash = hashSMSOTP(plainOtp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await db.loginSmsOtp.create({
      data: {
        userId: user.id,
        phoneNumber: user.phoneNumber,
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      },
    });

    // Send SMS via TextBee
    const smsMessage = `Your SecureDocX sign-in verification code is: ${plainOtp}. Valid for 5 minutes. Do not share this code.`;
    const smsResult = await sendTextBeeSMS(user.phoneNumber, smsMessage);

    await writeAuditLog({
      action: "LOGIN_OTP_REQUESTED",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: {
        maskedPhone: maskPhoneNumber(user.phoneNumber),
        simulated: smsResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      message: smsResult.simulated
        ? `Sign-in SMS OTP generated in test mode for ${maskPhoneNumber(user.phoneNumber)}.`
        : `A verification code has been dispatched via TextBee SMS to ${maskPhoneNumber(user.phoneNumber)}.`,
      maskedPhone: maskPhoneNumber(user.phoneNumber),
      simulated: smsResult.simulated,
      devCode: smsResult.simulated ? plainOtp : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Login:SendOTP] Error:", msg);
    return NextResponse.json({ error: "Failed to dispatch SMS verification code." }, { status: 500 });
  }
}
