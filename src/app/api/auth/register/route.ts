import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/lib/audit";
import { resolveClientIp } from "@/lib/security";
import { formatPhoneNumber } from "@/lib/textbee";

export async function POST(req: NextRequest) {
  try {
    const ip = resolveClientIp(req);
    const body = await req.json();
    const { email, phoneNumber, password, publicKey } = body;

    if (!email || !phoneNumber || !password) {
      return NextResponse.json(
        { error: "Email, mobile phone number, and password are all required to create an account." },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    // Check if email already registered
    const existingEmail = await db.user.findUnique({ where: { email: cleanEmail } });
    if (existingEmail) {
      return NextResponse.json(
        { error: "An account with this email address already exists." },
        { status: 409 }
      );
    }

    // Check if phone number already registered
    const existingPhone = await db.user.findFirst({ where: { phoneNumber: formattedPhone } });
    if (existingPhone) {
      return NextResponse.json(
        { error: "An account with this mobile phone number already exists." },
        { status: 409 }
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user with both email and phone number
    const user = await db.user.create({
      data: {
        email: cleanEmail,
        phoneNumber: formattedPhone,
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
      details: { email: user.email, phoneNumber: formattedPhone },
    });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, phoneNumber: user.phoneNumber },
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Failed to register user" }, { status: 500 });
  }
}
