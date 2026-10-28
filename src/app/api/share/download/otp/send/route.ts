import { NextRequest, NextResponse } from "next/server";
import { resolveClientIp } from "@/lib/security";
import { requestEmailOTP } from "@/lib/email-otp";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);

  try {
    const body = await req.json();
    const { id: linkId } = body;

    if (!linkId) {
      return NextResponse.json({ error: "Share Link ID is required." }, { status: 400 });
    }

    const result = await requestEmailOTP(linkId, ip);

    return NextResponse.json({
      success: true,
      message: result.message,
      maskedEmail: result.maskedEmail,
      expiresAt: result.expiresAt,
      validitySeconds: result.validitySeconds,
      resendCooldown: result.resendCooldown,
      simulated: result.simulated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to generate security code.";
    console.error("[EmailOTP Send Error]:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
