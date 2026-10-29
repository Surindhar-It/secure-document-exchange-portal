import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import { resolveClientIp } from "@/lib/security";
import { encryptSecret } from "@/lib/kms";
import { sendShareNotificationEmail, EmailDeliveryMode } from "@/lib/email-service";

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
      fileIds,
      transferMode = "STANDARD", // "STANDARD" | "BLOCKCHAIN"
      authMethod = "NONE", // "NONE" | "PASSWORD" | "EMAIL_OTP" | "BOTH"
      recipientEmail,
      expiresAt,
      maxDownloads,
      password,
      otpEnabled,
      allowedIps,
      allowedGeos,
      watermarkText,
      stegoEnabled = false,
      sendEmailNotification = false,
      emailDeliveryMode = "SEPARATE", // "COMBINED" | "SEPARATE" | "LINK_ONLY"
    } = body;

    // Support both single fileId and multiple fileIds (up to 20 files per link)
    let selectedFileIds: string[] = [];
    if (Array.isArray(fileIds) && fileIds.length > 0) {
      selectedFileIds = fileIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    } else if (fileId && typeof fileId === "string") {
      selectedFileIds = [fileId.trim()];
    }

    if (selectedFileIds.length === 0) {
      return NextResponse.json({ error: "At least one document must be selected for sharing." }, { status: 400 });
    }

    if (selectedFileIds.length > 20) {
      return NextResponse.json(
        { error: `A single transfer link can contain a maximum of 20 files. You selected ${selectedFileIds.length}.` },
        { status: 400 }
      );
    }

    // Determine authentication requirements
    const isOtpRequired = authMethod === "EMAIL_OTP" || authMethod === "BOTH" || !!otpEnabled;
    const isPasswordRequired = authMethod === "PASSWORD" || authMethod === "BOTH" || !!password;

    // Validate Recipient Email if OTP or email binding is required
    let sanitizedRecipientEmail: string | null = null;
    if (isOtpRequired || recipientEmail) {
      if (!recipientEmail || typeof recipientEmail !== "string" || !recipientEmail.trim()) {
        return NextResponse.json(
          { error: "Recipient email address is required when Email OTP Verification is configured." },
          { status: 400 }
        );
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(recipientEmail.trim())) {
        return NextResponse.json({ error: "Please provide a valid recipient email address format." }, { status: 400 });
      }
      sanitizedRecipientEmail = recipientEmail.trim().toLowerCase();
    }

    // Validate Password if password protection was chosen
    if (isPasswordRequired && (!password || password.trim().length === 0)) {
      return NextResponse.json(
        { error: "Access password is required when Password Protection is enabled." },
        { status: 400 }
      );
    }

    // Deduplicate
    selectedFileIds = Array.from(new Set(selectedFileIds));

    // Verify ownership of all selected files
    const userFiles = await db.fileMetadata.findMany({
      where: {
        id: { in: selectedFileIds },
        ownerId: sessionUser.id,
      },
    });

    if (userFiles.length !== selectedFileIds.length) {
      return NextResponse.json(
        { error: "One or more selected files could not be found or you do not have permission to share them." },
        { status: 404 }
      );
    }

    // Maintain the order in which user selected the files
    const orderedFiles = selectedFileIds
      .map((id) => userFiles.find((f) => f.id === id)!)
      .filter(Boolean);

    const primaryFile = orderedFiles[0];

    // Generate a random high-entropy sharing link ID (12 character URL-safe Base58 string)
    const shareLinkId = crypto.randomBytes(9).toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    // Process Password
    let passwordHash = null;
    let encryptedPassword = null;
    if (isPasswordRequired && password) {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
      // Encrypt the password using KMS envelope encryption so the backend can email it to recipient
      // without ever storing plaintext passwords in the database
      encryptedPassword = encryptSecret(password);
    }

    // Process OTP
    let otpSecret = null;
    if (isOtpRequired) {
      otpSecret = crypto.randomBytes(20).toString("hex");
    }

    // Calculate or retrieve Document Integrity Hash for all files
    for (const f of orderedFiles) {
      if (!f.signature && fs.existsSync(f.storagePath)) {
        const fileBytes = fs.readFileSync(f.storagePath);
        const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");
        f.signature = hash;
        await db.fileMetadata.update({
          where: { id: f.id },
          data: { signature: hash },
        });
      }
    }

    // Composite hash representing the bundle integrity
    let compositeDocumentHash: string;
    if (orderedFiles.length === 1) {
      compositeDocumentHash = orderedFiles[0].signature || "pending";
    } else {
      const bundleSignatures = orderedFiles.map((f) => f.signature || f.id).join(":");
      compositeDocumentHash = crypto.createHash("sha256").update(bundleSignatures).digest("hex");
    }

    // Generate protected Steganography verification token if enabled
    let stegoPayload: string | null = null;
    if (stegoEnabled) {
      stegoPayload = JSON.stringify({
        type: "SECUREDOCX_STEGO_TOKEN",
        version: "2.0",
        shareId: shareLinkId,
        fileCount: orderedFiles.length,
        mode: transferMode === "BLOCKCHAIN" ? "BLOCKCHAIN" : "STANDARD",
        documentHash: compositeDocumentHash,
        issuedAt: Date.now(),
      });
    }

    // Create share record with join model ShareLinkFile
    const shareLink = await db.shareLink.create({
      data: {
        id: shareLinkId,
        fileId: primaryFile.id,
        ownerId: sessionUser.id,
        transferMode: transferMode === "BLOCKCHAIN" ? "BLOCKCHAIN" : "STANDARD",
        authMethod,
        recipientEmail: sanitizedRecipientEmail,
        status: "ACTIVE",
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
        passwordHash,
        encryptedPassword,
        emailNotificationSent: false,
        emailDeliveryMode: sendEmailNotification ? (emailDeliveryMode || "SEPARATE") : null,
        otpSecret,
        otpEnabled: isOtpRequired,
        allowedIps: allowedIps || null,
        allowedGeos: allowedGeos || null,
        stegoEnabled: !!stegoEnabled,
        stegoPayload,
        watermarkText: watermarkText || null,
        files: {
          create: orderedFiles.map((f, idx) => ({
            fileId: f.id,
            order: idx,
          })),
        },
      },
      include: {
        files: {
          include: { file: true },
          orderBy: { order: "asc" },
        },
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
      documentHash: compositeDocumentHash,
      details: {
        shareLinkId: shareLink.id,
        primaryFileId: shareLink.fileId,
        fileCount: orderedFiles.length,
        fileIds: selectedFileIds,
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

    // Optional automated email notification delivery to recipient
    let emailDispatchResult = null;
    if (sendEmailNotification && sanitizedRecipientEmail) {
      const reqHeaders = req.headers;
      const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host") || "localhost:3000";
      const proto = reqHeaders.get("x-forwarded-proto") || "http";
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
      const shareUrl = `${baseUrl.replace(/\/$/, "")}/d/${shareLink.id}`;

      emailDispatchResult = await sendShareNotificationEmail({
        recipientEmail: sanitizedRecipientEmail,
        senderEmail: sessionUser.email,
        shareUrl,
        shareLinkId: shareLink.id,
        fileNames: orderedFiles.map((f) => f.fileName),
        fileCount: orderedFiles.length,
        password: password || null,
        authMethod,
        transferMode: shareLink.transferMode as "STANDARD" | "BLOCKCHAIN",
        expiresAt: shareLink.expiresAt,
        maxDownloads: shareLink.maxDownloads,
        deliveryMode: (emailDeliveryMode as EmailDeliveryMode) || "SEPARATE",
        clientIp: ip,
      });

      if (emailDispatchResult.success) {
        await db.shareLink.update({
          where: { id: shareLink.id },
          data: {
            emailNotificationSent: true,
            emailDeliveryMode: emailDispatchResult.deliveryMode,
          },
        });
      }
    }

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
        files: shareLink.files.map((sf) => ({
          id: sf.file.id,
          fileName: sf.file.fileName,
          fileSize: sf.file.fileSize,
          mimeType: sf.file.mimeType,
          signature: sf.file.signature,
          originalHash: sf.file.originalHash,
        })),
        transferMode: shareLink.transferMode,
        recipientEmail: shareLink.recipientEmail,
        emailNotificationSent: emailDispatchResult ? emailDispatchResult.success : false,
        emailDeliveryMode: emailDispatchResult ? emailDispatchResult.deliveryMode : null,
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
      emailNotification: emailDispatchResult ? {
        sent: emailDispatchResult.success,
        deliveryMode: emailDispatchResult.deliveryMode,
        messagesSent: emailDispatchResult.messagesSent,
        simulated: emailDispatchResult.simulated,
        error: emailDispatchResult.error,
      } : null,
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
