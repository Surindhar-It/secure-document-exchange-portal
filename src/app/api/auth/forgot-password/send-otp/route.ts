import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
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
    const { identifier, phone } = body;

    if (!identifier || typeof identifier !== "string") {
      return NextResponse.json(
        { error: "Please enter your registered email address or phone number." },
        { status: 400 }
      );
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    // Look up user by email or by phone number
    const user = await db.user.findFirst({
      where: {
        OR: [
          { email: cleanIdentifier },
          { phoneNumber: formatPhoneNumber(cleanIdentifier) },
        ],
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "No account found matching this email address or phone number." },
        { status: 404 }
      );
    }

    // Resolve target phone number
    let targetPhone = user.phoneNumber;
    if (!targetPhone && phone) {
      targetPhone = formatPhoneNumber(phone);
      // Link the phone number to the user account
      await db.user.update({
        where: { id: user.id },
        data: { phoneNumber: targetPhone },
      });
    }

    if (!targetPhone) {
      return NextResponse.json(
        {
          error: "No phone number is registered with this account.",
          requiresPhoneInput: true,
        },
        { status: 400 }
      );
    }

    // Check cooldown from latest OTP request (60 seconds)
    const latestOtp = await db.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    if (latestOtp && now.getTime() - latestOtp.createdAt.getTime() < 60000) {
      const waitSeconds = Math.ceil((60000 - (now.getTime() - latestOtp.createdAt.getTime())) / 1000);
      return NextResponse.json(
        { error: `Please wait ${waitSeconds} second(s) before requesting a new SMS OTP.` },
        { status: 429 }
      );
    }

    // Invalidate prior unused OTP records
    await db.passwordResetOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    // Generate new OTP
    const plainOtp = generateSMSOTP();
    const otpHash = hashSMSOTP(plainOtp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    await db.passwordResetOtp.create({
      data: {
        userId: user.id,
        phoneNumber: targetPhone,
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      },
    });

    // Dispatch SMS via TextBee
    const smsMessage = `Your SecureDocX password reset verification code is: ${plainOtp}. Valid for 5 minutes. Never share this code with anyone.`;
    const smsResult = await sendTextBeeSMS(targetPhone, smsMessage);

    await recordAuditEvent({
      action: "PASSWORD_RESET_OTP_REQUESTED",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: {
        maskedPhone: maskPhoneNumber(targetPhone),
        simulated: smsResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      message: smsResult.simulated
        ? `SMS OTP generated in test mode for ${maskPhoneNumber(targetPhone)}.`
        : `A verification code has been dispatched via TextBee SMS to ${maskPhoneNumber(targetPhone)}.`,
      maskedPhone: maskPhoneNumber(targetPhone),
      simulated: smsResult.simulated,
      devCode: smsResult.simulated ? plainOtp : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ForgotPassword:SendOTP] Error:", msg);
    return NextResponse.json({ error: "Failed to dispatch SMS verification code." }, { status: 500 });
  }
}
