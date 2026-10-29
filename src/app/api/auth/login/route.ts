import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import { formatPhoneNumber } from "@/lib/textbee";

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

    // If MFA is enabled, require MFA completion step
    if (user.mfaEnabled) {
      return NextResponse.json({
        mfaRequired: true,
        userId: user.id,
        email: user.email,
      });
    }

    // Write login success audit block
    await writeAuditLog({
      action: "LOGIN_SUCCESS",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent,
    });

    // Sign JWT and set HTTP-only cookie
    const token = signJwtToken({ id: user.id, email: user.email });
    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, publicKey: user.publicKey },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "An internal server error occurred" }, { status: 500 });
  }
}
