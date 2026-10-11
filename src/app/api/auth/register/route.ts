import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";

export async function POST(req: NextRequest) {
  try {
    const ip = resolveClientIp(req);
    const body = await req.json();
    const { email, password, publicKey } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Check rate limits & security threat for IP
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = await db.user.create({
      data: {
        email,
        passwordHash,
        publicKey: publicKey || null,
      },
    });

    // Write audit log
    await writeAuditLog({
      action: "USER_REGISTER",
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
      details: { email: user.email },
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email },
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Failed to register user" }, { status: 500 });
  }
}
