import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import { resolveClientIp } from "@/lib/security";

export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      fileId,
      transferMode = "STANDARD", // "STANDARD" | "BLOCKCHAIN"
      recipientEmail,
      expiresAt,
      maxDownloads,
      password,
      otpEnabled,
      allowedIps,
      allowedGeos,
      watermarkText,
      stegoEnabled = false,
    } = body;

    if (!fileId) {
      return NextResponse.json({ error: "File ID is required" }, { status: 400 });
    }

    // Verify file ownership
    const file = await db.fileMetadata.findFirst({
      where: { id: fileId, ownerId: sessionUser.id },
    });

    if (!file) {
      return NextResponse.json({ error: "File not found or unauthorized" }, { status: 404 });
    }

    // Generate a random high-entropy sharing link ID (12 character URL-safe Base58 string)
    const shareLinkId = crypto.randomBytes(9).toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    // Process Password
    let passwordHash = null;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    }

    // Process OTP
    let otpSecret = null;
    if (otpEnabled) {
      otpSecret = crypto.randomBytes(20).toString("hex");
    }

    // Calculate or retrieve Document Integrity Hash (SHA-256 of encrypted file payload)
    let documentHash = file.signature;
    if (!documentHash && fs.existsSync(file.storagePath)) {
      const fileBytes = fs.readFileSync(file.storagePath);
      documentHash = crypto.createHash("sha256").update(fileBytes).digest("hex");
      // Persist signature to file record if not previously cached
      await db.fileMetadata.update({
        where: { id: file.id },
        data: { signature: documentHash },
      });
    }

    // Generate protected Steganography verification token if enabled
    let stegoPayload: string | null = null;
    if (stegoEnabled) {
      stegoPayload = JSON.stringify({
        type: "SECUREDOCX_STEGO_TOKEN",
        version: "1.0",
        shareId: shareLinkId,
        mode: transferMode === "BLOCKCHAIN" ? "BLOCKCHAIN" : "STANDARD",
        documentHash: documentHash || file.signature || "pending",
        issuedAt: Date.now(),
      });
    }

    // Create share record
    const shareLink = await db.shareLink.create({
      data: {
        id: shareLinkId,
        fileId,
        ownerId: sessionUser.id,
        transferMode: transferMode === "BLOCKCHAIN" ? "BLOCKCHAIN" : "STANDARD",
        recipientEmail: recipientEmail ? recipientEmail.trim().toLowerCase() : null,
        status: "ACTIVE",
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
        passwordHash,
        otpSecret,
        otpEnabled: !!otpEnabled,
        allowedIps: allowedIps || null,
        allowedGeos: allowedGeos || null,
        stegoEnabled: !!stegoEnabled,
        stegoPayload,
        watermarkText: watermarkText || null,
      },
    });

    // Write audit event (Dispatches to BlockchainAuditService if transferMode == BLOCKCHAIN)
    await recordAuditEvent({
      action: "SHARE_CREATED",
      userId: sessionUser.id,
      userEmail: sessionUser.email,
      ipAddress: ip,
      userAgent,
      transferMode: shareLink.transferMode as "STANDARD" | "BLOCKCHAIN",
      shareLinkId: shareLink.id,
      fileId: shareLink.fileId,
      documentHash: documentHash || undefined,
      details: {
        shareLinkId: shareLink.id,
        fileId: shareLink.fileId,
        transferMode: shareLink.transferMode,
        recipientEmail: shareLink.recipientEmail,
        limits: {
          expiresAt: shareLink.expiresAt,
          maxDownloads: shareLink.maxDownloads,
          passwordProtected: !!passwordHash,
          otpEnabled: shareLink.otpEnabled,
          allowedIps: shareLink.allowedIps,
          allowedGeos: shareLink.allowedGeos,
        },
      },
    });

    // Fetch newly attached blockchain proof if created
    const proof = await db.blockchainProof.findFirst({
      where: { shareLinkId: shareLink.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      shareLink: {
        id: shareLink.id,
        fileId: shareLink.fileId,
        transferMode: shareLink.transferMode,
        recipientEmail: shareLink.recipientEmail,
        status: shareLink.status,
        expiresAt: shareLink.expiresAt,
        maxDownloads: shareLink.maxDownloads,
        otpEnabled: shareLink.otpEnabled,
        allowedIps: shareLink.allowedIps,
        allowedGeos: shareLink.allowedGeos,
        stegoEnabled: shareLink.stegoEnabled,
        stegoPayload: shareLink.stegoPayload,
        watermarkText: shareLink.watermarkText,
      },
      blockchainProof: proof ? {
        proofId: proof.proofId,
        documentHash: proof.documentHash,
        status: proof.status,
        network: proof.network,
      } : null,
    });
  } catch (error) {
    console.error("Link creation error:", error);
    return NextResponse.json({ error: "Failed to create sharing link" }, { status: 500 });
  }
}
