import { NextRequest, NextResponse } from "next/server";
import { resolveClientIp } from "@/lib/security";
import { requestEmailOTP, verifyEmailOTP } from "@/lib/email-otp";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);

  try {
    const body = await req.json();
    const { id: linkId, action = "send", otpCode } = body;

    if (!linkId) {
      return NextResponse.json({ error: "Share Link ID is required." }, { status: 400 });
    }

    if (action === "verify" || otpCode) {
      const verifyResult = await verifyEmailOTP(linkId, otpCode, ip);
      return NextResponse.json(verifyResult);
    }

    const sendResult = await requestEmailOTP(linkId, ip);
    return NextResponse.json(sendResult);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to process OTP request.";
    console.error("[EmailOTP Route Error]:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
