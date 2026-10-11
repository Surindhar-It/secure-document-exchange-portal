import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, signJwtToken } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";

const RP_NAME = "FortressShare Portal";

function getRpAndOrigin(req: NextRequest) {
  const host = req.headers.get("host") || "localhost:3000";
  const rpId = host.split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const expectedOrigin = req.headers.get("origin") || `${proto}://${host}`;
  return { rpId, expectedOrigin };
}

// GET: Generate Passkey Challenge Options
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const email = searchParams.get("email");
  const { rpId } = getRpAndOrigin(req);

  try {
    if (action === "register-options") {
      // 1. User registration options
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const userRecord = await db.user.findUnique({
        where: { id: sessionUser.id },
        include: { passkeys: true },
      });

      if (!userRecord) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userID: new TextEncoder().encode(userRecord.id),
        userName: userRecord.email,
        userDisplayName: userRecord.email.split("@")[0],
        // Exclude credentials they already registered
        excludeCredentials: userRecord.passkeys.map((pk) => ({
          id: pk.id,
          type: "public-key",
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      // Save challenge in secure cookie
      const response = NextResponse.json(options);
      response.cookies.set("passkey_challenge", options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 300, // 5 minutes
      });
      return response;
    }

    if (action === "login-options") {
      // 2. User login options
      let allowedCredentials = undefined;

      if (email) {
        const userRecord = await db.user.findUnique({
          where: { email },
          include: { passkeys: true },
        });
        if (userRecord && userRecord.passkeys.length > 0) {
          allowedCredentials = userRecord.passkeys.map((pk) => ({
            id: pk.id,
            type: "public-key" as const,
          }));
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        allowCredentials: allowedCredentials,
        userVerification: "preferred",
      });

      const response = NextResponse.json(options);
      response.cookies.set("passkey_challenge", options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 300, // 5 minutes
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Passkey Options Error:", error);
    return NextResponse.json({ error: "Failed to generate passkey options" }, { status: 500 });
  }
}

// POST: Verify Cryptographic Passkey Response
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");
  const { rpId, expectedOrigin } = getRpAndOrigin(req);

  const expectedChallenge = req.cookies.get("passkey_challenge")?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "Passkey challenge expired or missing" }, { status: 400 });
  }

  try {
    const body = await req.json();

    if (action === "register-verify") {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpId,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential } = verification.registrationInfo;
        const { id, publicKey, counter } = credential;

        // Convert base64url credentialPublicKey to base64
        const pubKeyBase64 = Buffer.from(publicKey).toString("base64");

        // Save credential
        await db.passkey.create({
          data: {
            id: id,
            publicKey: pubKeyBase64,
            counter: counter,
            userId: sessionUser.id,
          },
        });

        await writeAuditLog({
          action: "PASSKEY_REGISTER",
          userId: sessionUser.id,
          userEmail: sessionUser.email,
          ipAddress: ip,
          userAgent,
        });

        const response = NextResponse.json({ verified: true });
        response.cookies.delete("passkey_challenge");
        return response;
      }

      return NextResponse.json({ error: "Failed to verify passkey registration" }, { status: 400 });
    }

    if (action === "login-verify") {
      const credentialId = body.id;
      const passkey = await db.passkey.findUnique({
        where: { id: credentialId },
        include: { user: true },
      });

      if (!passkey) {
        return NextResponse.json({ error: "Passkey credential not found" }, { status: 404 });
      }

      // Reconstruct raw buffer from Base64 public key
      const credentialPublicKey = Buffer.from(passkey.publicKey, "base64");

      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpId,
        credential: {
          id: passkey.id,
          publicKey: credentialPublicKey,
          counter: passkey.counter,
        },
      });

      if (verification.verified && verification.authenticationInfo) {
        // Update credential counter
        await db.passkey.update({
          where: { id: passkey.id },
          data: { counter: verification.authenticationInfo.newCounter },
        });

        // Set Cookie & Authenticate
        const user = passkey.user;
        const token = signJwtToken({ id: user.id, email: user.email });

        await writeAuditLog({
          action: "LOGIN_SUCCESS_PASSKEY",
          userId: user.id,
          userEmail: user.email,
          ipAddress: ip,
          userAgent,
        });

        const response = NextResponse.json({
          verified: true,
          user: { id: user.id, email: user.email, publicKey: user.publicKey },
        });

        response.cookies.delete("passkey_challenge");
        response.cookies.set("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return response;
      }

      // Log failure in hash chain
      await writeAuditLog({
        action: "LOGIN_FAIL_PASSKEY",
        userEmail: passkey.user.email,
        ipAddress: ip,
        userAgent,
        details: { reason: "Passkey cryptographic validation failed" },
      });

      return NextResponse.json({ error: "Failed to authenticate passkey" }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Passkey Verification Error:", error);
    return NextResponse.json({ error: "An error occurred during verification" }, { status: 500 });
  }
}
