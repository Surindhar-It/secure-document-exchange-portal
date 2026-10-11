import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Ensure storage directory exists
const STORAGE_DIR = path.join(process.cwd(), "storage", "encrypted");
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  // Authenticate user
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as Blob | File | null;
    let fileName = formData.get("fileName") as string | null;
    const fileSizeStr = formData.get("fileSize") as string | null;
    const mimeType = (formData.get("mimeType") as string) || "application/octet-stream";
    const signature = formData.get("signature") as string | null; // Ciphertext SHA-256 signature
    const originalHash = formData.get("originalHash") as string | null; // Original document SHA-256 hash
    const dekHex = formData.get("dekHex") as string | null; // Raw DEK sent for immediate KMS wrapping
    const iv = formData.get("iv") as string | null;
    const authTag = formData.get("authTag") as string | null;
    const encryptionAlgo = (formData.get("encryptionAlgo") as string) || "AES-256-GCM";
    const encryptionVersion = (formData.get("encryptionVersion") as string) || "1.0";

    if (!file) {
      return NextResponse.json({ error: "File payload is required" }, { status: 400 });
    }

    // Determine filename
    if (!fileName) {
      const rawName = (file as any).name || "encrypted_payload.bin";
      fileName = Buffer.from(rawName).toString("base64");
    }

    // Determine filesize
    let fileSize = file.size;
    if (fileSizeStr) {
      const parsed = parseInt(fileSizeStr);
      if (!isNaN(parsed) && parsed > 0) {
        fileSize = parsed;
      }
    }

    // AI Threat evaluation (e.g. data exfiltration checks for abnormal upload sizes)
    const threatReport = await evaluateAccessThreat({
      ipAddress: ip,
      userEmail: sessionUser.email,
      action: "UPLOAD",
      details: { fileSizeMb: fileSize / (1024 * 1024) },
    });

    // Check if threat classification block is triggered
    if (threatReport.isThreat && threatReport.threatType === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        {
          error: "Upload blocked. Suspicious data volume activity detected.",
          threatType: threatReport.threatType,
        },
        { status: 403 }
      );
    }

    // Generate unique storage name
    const fileId = crypto.randomUUID();
    const storagePath = path.join(STORAGE_DIR, `${fileId}.enc`);

    // Write file payload locally
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(storagePath, fileBuffer);

    // Compute ciphertext SHA-256 signature if not passed
    const ciphertextHash = signature || crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Protect DEK using KMS Envelope Encryption (Never store raw keys!)
    let encryptedKeyPackage: string | null = null;
    if (dekHex && dekHex.length === 64) {
      const { wrapDEK } = await import("@/lib/kms");
      encryptedKeyPackage = wrapDEK(dekHex);
    }

    // Save metadata in SQLite
    const metadata = await db.fileMetadata.create({
      data: {
        id: fileId,
        fileName,
        fileSize,
        mimeType,
        storagePath,
        signature: ciphertextHash,
        originalHash: originalHash || null,
        encryptionAlgo,
        encryptionVersion,
        iv: iv || null,
        authTag: authTag || null,
        encryptedKeyPackage,
        ownerId: sessionUser.id,
      },
    });

    // Record on blockchain ledger / audit chain
    await recordAuditEvent({
      action: "DOCUMENT_ENCRYPTION",
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      ipAddress: ip,
      userAgent,
      fileId: metadata.id,
      documentHash: ciphertextHash,
      details: {
        fileId: metadata.id,
        fileSize: metadata.fileSize,
        mimeType: metadata.mimeType,
        encryptionAlgo: metadata.encryptionAlgo,
        encryptionVersion: metadata.encryptionVersion,
        hasOriginalHash: !!metadata.originalHash,
        hasKmsPackage: !!encryptedKeyPackage,
      },
    });

    return NextResponse.json({
      success: true,
      file: {
        id: metadata.id,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        createdAt: metadata.createdAt,
        encryptionAlgo: metadata.encryptionAlgo,
        encryptionVersion: metadata.encryptionVersion,
        originalHash: metadata.originalHash,
      },
    });
  } catch (error) {
    console.error("Upload route error:", error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}

// GET: List user's uploaded files
export async function GET(req: NextRequest) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const files = await db.fileMetadata.findMany({
      where: { ownerId: sessionUser.id },
      orderBy: { createdAt: "desc" },
    });

    const user = await db.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true, mfaEnabled: true },
    });

    return NextResponse.json({ files, user });
  } catch (error) {
    console.error("Fetch files error:", error);
    return NextResponse.json({ error: "Failed to retrieve files" }, { status: 500 });
  }
}
