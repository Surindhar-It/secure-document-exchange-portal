import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// GET: Retrieve threats and check FastAPI engine status
export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch threat logs
    const threats = await db.securityThreat.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    // 2. Check if Python FastAPI service is online
    let aiEngineOnline = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 800); // 800ms timeout
      const response = await fetch("http://127.0.0.1:8000/health", { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const health = await response.json();
        aiEngineOnline = health.status === "healthy";
      }
    } catch (e) {
      aiEngineOnline = false;
    }

    return NextResponse.json({
      success: true,
      threats,
      aiEngineOnline,
    });
  } catch (error) {
    console.error("Threat fetch error:", error);
    return NextResponse.json({ error: "Failed to retrieve security center stats" }, { status: 500 });
  }
}

// POST: Resolve or update threat status
export async function POST(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { threatId, status } = body; // status can be "RESOLVED" or "OPEN" or "IGNORED"

    if (!threatId || !status) {
      return NextResponse.json({ error: "Threat ID and status are required" }, { status: 400 });
    }

    const threat = await db.securityThreat.update({
      where: { id: threatId },
      data: { status },
    });

    return NextResponse.json({ success: true, threat });
  } catch (error) {
    console.error("Threat resolve error:", error);
    return NextResponse.json({ error: "Failed to update threat state" }, { status: 500 });
  }
}
