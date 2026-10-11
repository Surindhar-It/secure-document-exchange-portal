import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fortress-share-super-secret-key-1029384756";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

// 1. Sign JWT Token
export function signJwtToken(payload: AuthenticatedUser): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// 2. Verify JWT Token
export function verifyJwtToken(token: string): AuthenticatedUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
  } catch {
    return null;
  }
}

// 3. Extract and Authenticate User from Request Cookies
export function getSessionUser(req: NextRequest): AuthenticatedUser | null {
  try {
    const token = req.cookies.get("token")?.value;
    if (!token) return null;
    return verifyJwtToken(token);
  } catch {
    return null;
  }
}
