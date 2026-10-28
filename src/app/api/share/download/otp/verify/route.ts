import { NextRequest, NextResponse } from "next/server";
import { resolveClientIp } from "@/lib/security";
import { verifyEmailOTP } from "@/lib/email-otp";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);

  try {
    const body = await req.json();
    const { id: linkId, otpCode } = body;

    if (!linkId) {
      return NextResponse.json({ error: "Share Link ID is required." }, { status: 400 });
    }

    if (!otpCode) {
      return NextResponse.json({ error: "Please provide the 6-digit verification code." }, { status: 400 });
    }

    const result = await verifyEmailOTP(linkId, otpCode, ip);

    return NextResponse.json({
      success: true,
      message: result.message,
      sessionToken: result.sessionToken,
      sessionExpiresAt: result.sessionExpiresAt,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to verify security code.";
    console.error("[EmailOTP Verify Error]:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
