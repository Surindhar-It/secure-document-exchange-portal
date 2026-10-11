import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSecret, generateURI, verifySync } from "otplib";
import qrcode from "qrcode";
import { getSessionUser, signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";

// 1. GET: Initiate MFA Setup (Generates TOTP secret and QR code)
export async function GET(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const forceReset = searchParams.get("reset") === "true";

    const userRecord = await db.user.findUnique({ where: { id: user.id } });
    if (!userRecord) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Reuse existing secret if not confirmed yet, unless a reset is forced
    let secret = userRecord.mfaSecret;
    if (!secret || forceReset || userRecord.mfaEnabled) {
      secret = generateSecret();
      await db.user.update({
        where: { id: user.id },
        data: { 
          mfaSecret: secret,
          mfaEnabled: false 
        },
      });
    }

    const serviceName = "FortressShare";
    const otpauthUrl = generateURI({ label: user.email, issuer: serviceName, secret });
    
    // Generate QR Code Data URL
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return NextResponse.json({
      secret,
      qrCodeDataUrl,
    });
  } catch (error) {
    console.error("MFA GET error:", error);
    return NextResponse.json({ error: "Failed to initialize MFA" }, { status: 500 });
  }
}

// 2. POST: Verify OTP code (for either Setup Confirmation or Login MFA verification)
export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { code, userId } = body; // userId is passed for login, session user is used for setup

    if (!code) {
      return NextResponse.json({ error: "MFA code is required" }, { status: 400 });
    }

    let userRecord = null;
    let isSetupMode = false;

    // Check if we are in login verification mode or setup verification mode
    if (userId) {
      userRecord = await db.user.findUnique({ where: { id: userId } });
    } else {
      const sessionUser = getSessionUser(req);
      if (sessionUser) {
        userRecord = await db.user.findUnique({ where: { id: sessionUser.id } });
        isSetupMode = true;
      }
    }

    if (!userRecord || !userRecord.mfaSecret) {
      return NextResponse.json({ error: "MFA is not configured for this user" }, { status: 400 });
    }

    // Verify TOTP Code
    const verificationResult = verifySync({
      token: code,
      secret: userRecord.mfaSecret,
      epochTolerance: 60, // 60 seconds (2 periods) time drift tolerance
    });

    if (!verificationResult || !verificationResult.valid) {
      await writeAuditLog({
        action: isSetupMode ? "MFA_SETUP_FAIL" : "LOGIN_MFA_FAIL",
        userId: userRecord.id,
        userEmail: userRecord.email,
        ipAddress: ip,
        userAgent,
        details: { reason: "Incorrect OTP code" },
      });
      return NextResponse.json({ error: "Invalid authenticator code" }, { status: 400 });
    }

    // If in setup mode, enable MFA permanently
    if (isSetupMode) {
      await db.user.update({
        where: { id: userRecord.id },
        data: { mfaEnabled: true },
      });
      await writeAuditLog({
        action: "MFA_SETUP_SUCCESS",
        userId: userRecord.id,
        userEmail: userRecord.email,
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json({ success: true, mfaEnabled: true });
    }

    // Write login success audit block
    await writeAuditLog({
      action: "LOGIN_SUCCESS_MFA",
      userId: userRecord.id,
      userEmail: userRecord.email,
      ipAddress: ip,
      userAgent,
    });

    // Issuing session token on successful login verification
    const token = signJwtToken({ id: userRecord.id, email: userRecord.email });
    const response = NextResponse.json({
      success: true,
      user: { id: userRecord.id, email: userRecord.email, publicKey: userRecord.publicKey },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    console.error("MFA POST error:", error);
    return NextResponse.json({ error: "Failed to verify MFA code" }, { status: 500 });
  }
}

// 3. DELETE: Disable/Remove Multi-Factor Authentication
export async function DELETE(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userRecord = await db.user.findUnique({ where: { id: sessionUser.id } });
    if (!userRecord) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Disable MFA
    await db.user.update({
      where: { id: sessionUser.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    // Write audit log entry
    await writeAuditLog({
      action: "MFA_DISABLED",
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({ success: true, mfaEnabled: false });
  } catch (error) {
    console.error("MFA DELETE error:", error);
    return NextResponse.json({ error: "Failed to disable MFA" }, { status: 500 });
  }
}
