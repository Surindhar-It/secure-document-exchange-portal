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
import { sendPasswordResetEmailOTP, maskEmail } from "@/lib/email-otp";

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

    // Resolve target phone number if provided or already linked
    let targetPhone = user.phoneNumber;
    if (!targetPhone && phone) {
      targetPhone = formatPhoneNumber(phone);
      // Link the phone number to the user account
      await db.user.update({
        where: { id: user.id },
        data: { phoneNumber: targetPhone },
      });
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
        { error: `Please wait ${waitSeconds} second(s) before requesting a new OTP.` },
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
        phoneNumber: targetPhone || user.email,
        otpHash,
        expiresAt,
        attempts: 0,
        maxAttempts: 5,
        isUsed: false,
      },
    });

    // 1. Dispatch SMS via TextBee (if phone available)
    let smsResult: { success: boolean; simulated: boolean; error?: string } = { success: false, simulated: false };
    if (targetPhone) {
      const smsMessage = `Your SecureDocX password reset verification code is: ${plainOtp}. Valid for 5 minutes. Never share this code with anyone.`;
      smsResult = await sendTextBeeSMS(targetPhone, smsMessage);
    }

    // 2. Dispatch Email OTP to registered email address
    let emailResult: { success: boolean; simulated: boolean; error?: string } = { success: false, simulated: false };
    if (user.email) {
      emailResult = await sendPasswordResetEmailOTP(user.email, plainOtp);
    }

    const maskedPhone = targetPhone ? maskPhoneNumber(targetPhone) : null;
    const maskedEmail = user.email ? maskEmail(user.email) : null;

    let message = "";
    if (maskedEmail && maskedPhone) {
      message = `Verification code sent to your email (${maskedEmail}) and SMS (${maskedPhone}).`;
    } else if (maskedEmail) {
      message = `Verification code sent to your email (${maskedEmail}).`;
    } else if (maskedPhone) {
      message = `Verification code sent via SMS to ${maskedPhone}.`;
    } else {
      message = "Verification code generated successfully.";
    }

    await recordAuditEvent({
      action: "PASSWORD_RESET_OTP_REQUESTED",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
      details: {
        maskedPhone,
        maskedEmail,
        smsSimulated: smsResult.simulated,
        emailSimulated: emailResult.simulated,
      },
    });

    return NextResponse.json({
      success: true,
      message,
      maskedPhone,
      maskedEmail,
      simulated: smsResult.simulated || emailResult.simulated,
      devCode: (smsResult.simulated || emailResult.simulated) ? plainOtp : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ForgotPassword:SendOTP] Error:", msg);
    return NextResponse.json({ error: "Failed to dispatch verification code." }, { status: 500 });
  }
}
