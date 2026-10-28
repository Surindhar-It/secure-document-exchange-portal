import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { evaluateAccessThreat, resolveClientIp } from "@/lib/security";
import { evaluateAccessPolicy } from "@/lib/access-policy";
import fs from "fs";

// 1. GET: Fetch Share Link metadata, policy barriers, and transfer mode details
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  const simGeo = searchParams.get("geo"); // Country code selected by recipient
  const claimedEmail = searchParams.get("email");

  const ip = resolveClientIp(req);

  if (!linkId) {
    return NextResponse.json({ error: "Share Link ID is required" }, { status: 400 });
  }

  try {
    const link = await db.shareLink.findUnique({
      where: { id: linkId },
      include: {
        file: true,
        files: {
          include: { file: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!link || link.isRevoked || link.status === "REVOKED") {
      return NextResponse.json({ error: "Sharing link is invalid or has been revoked." }, { status: 404 });
    }

    if (link.status === "FROZEN" || link.status === "BLOCKED") {
      return NextResponse.json(
        { error: "This secure transfer has been frozen due to security policy violations." },
        { status: 403 }
      );
    }

    if (link.expiresAt && new Date() > link.expiresAt) {
      return NextResponse.json({ error: "Sharing link has expired." }, { status: 403 });
    }

    if (link.maxDownloads && link.downloadCount >= link.maxDownloads) {
      return NextResponse.json({ error: "Sharing link download limit exceeded." }, { status: 403 });
    }

    // Check Geo Restrictions if applicable
    const hasGeoRestriction = !!(link.allowedGeos && link.allowedGeos.trim().length > 0);
    if (hasGeoRestriction && simGeo) {
      const allowedCountries = link.allowedGeos!.split(",").map((c) => c.trim().toUpperCase());
      if (!allowedCountries.includes(simGeo.toUpperCase())) {
        await evaluateAccessThreat({
          ipAddress: ip,
          action: "GEO_MISMATCH",
          details: { linkId, geoCountry: simGeo, allowedCountries },
        });
        return NextResponse.json(
          { error: `Access denied: Your selected location (${simGeo}) is not authorized for this link.` },
          { status: 403 }
        );
      }
    }

    // Check Recipient Binding requirement
    const hasRecipientBinding = !!link.recipientEmail;

    // Fetch latest BlockchainProof record if transfer mode is BLOCKCHAIN
    let blockchainProof = null;
    if (link.transferMode === "BLOCKCHAIN") {
      blockchainProof = await db.blockchainProof.findFirst({
        where: { shareLinkId: link.id },
        orderBy: { createdAt: "desc" },
      });
    }

    // Resolve list of files in bundle
    const allFiles = link.files && link.files.length > 0
      ? link.files.map((sf) => sf.file)
      : (link.file ? [link.file] : []);

    const filesData = allFiles.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      fileSize: f.fileSize,
      mimeType: f.mimeType,
      encryptionAlgo: f.encryptionAlgo,
      encryptionVersion: f.encryptionVersion,
      signature: f.signature, // SHA-256 of encrypted ciphertext
      originalHash: f.originalHash, // SHA-256 of original unencrypted document
    }));

    // Return meta details
    return NextResponse.json({
      success: true,
      transferMode: link.transferMode,
      status: link.status,
      hasGeoRestriction,
      hasRecipientBinding,
      recipientEmail: link.recipientEmail,
      expiresAt: link.expiresAt,
      maxDownloads: link.maxDownloads,
      downloadCount: link.downloadCount,
      fileCount: allFiles.length,
      // Expose file metadata only if geo restriction satisfied (or none required)
      ...(hasGeoRestriction && !simGeo
        ? {}
        : {
            files: filesData,
            file: filesData[0] || null,
            stegoEnabled: link.stegoEnabled,
            passwordRequired: !!link.passwordHash,
            otpRequired: link.otpEnabled,
            watermarkText: link.watermarkText,
          }),
      blockchainProof: blockchainProof
        ? {
            proofId: blockchainProof.proofId,
            documentHash: blockchainProof.documentHash,
            status: blockchainProof.status,
            network: blockchainProof.network,
            contractAddress: blockchainProof.contractAddress,
            txHash: blockchainProof.txHash,
          }
        : null,
    });
  } catch (error) {
    console.error("Fetch share meta error:", error);
    return NextResponse.json({ error: "Failed to fetch link metadata" }, { status: 500 });
  }
}

// 2. POST: Enforce Access Policy Engine & Stream Encrypted Ciphertext
export async function POST(req: NextRequest) {
  const ip = resolveClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const body = await req.json();
    const { id: linkId, fileId, password, otpCode, geo, email: claimedEmail } = body;

    if (!linkId) {
      return NextResponse.json({ error: "Share Link ID is required" }, { status: 400 });
    }

    // Central Access Policy Engine verification with atomic download execution
    const policyResult = await evaluateAccessPolicy(
      {
        linkId,
        clientIp: ip,
        userAgent,
        password: password || null,
        otpCode: otpCode || null,
        claimedEmail: claimedEmail || null,
        geoCountry: geo || null,
      },
      true // Execute atomic download counter increment
    );

    if (!policyResult.granted) {
      // Record access failure audit event
      await recordAuditEvent({
        action: "LINK_ACCESS_FAIL",
        ipAddress: ip,
        userAgent,
        shareLinkId: linkId,
        details: {
          linkId,
          status: policyResult.status,
          reason: policyResult.reason,
          riskScore: policyResult.riskAssessment.score,
        },
      });

      // If Policy Engine froze the link due to high risk, record on blockchain if applicable
      if (policyResult.status === "FROZEN" && policyResult.link?.transferMode === "BLOCKCHAIN") {
        await recordAuditEvent({
          action: "HIGH_RISK_BLOCK",
          ipAddress: ip,
          userAgent,
          transferMode: "BLOCKCHAIN",
          shareLinkId: linkId,
          fileId: policyResult.link.fileId,
          documentHash: policyResult.link.file?.signature,
          details: {
            reason: policyResult.reason,
            riskScore: policyResult.riskAssessment.score,
          },
        });
      }

      return NextResponse.json(
        { error: policyResult.reason, policyStatus: policyResult.status },
        { status: 403 }
      );
    }

    const link = policyResult.link;

    // Resolve target file from bundle or single file
    const allFiles = (link.files && link.files.length > 0)
      ? link.files.map((sf: any) => sf.file)
      : (link.file ? [link.file] : []);

    let targetFile = allFiles[0];
    if (fileId) {
      const found = allFiles.find((f: any) => f.id === fileId);
      if (found) {
        targetFile = found;
      } else {
        return NextResponse.json(
          { error: "Requested document was not found in this transfer bundle." },
          { status: 404 }
        );
      }
    }

    if (!targetFile) {
      return NextResponse.json({ error: "No document attached to this transfer link." }, { status: 404 });
    }

    const filePath = targetFile.storagePath;

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Encrypted payload missing on server" }, { status: 404 });
    }

    // Record verified download completion in database and blockchain
    await recordAuditEvent({
      action: "DOWNLOAD_COMPLETED",
      userId: link.ownerId,
      userEmail: claimedEmail || `Shared Recipient (${ip})`,
      ipAddress: ip,
      userAgent,
      transferMode: link.transferMode as "STANDARD" | "BLOCKCHAIN",
      shareLinkId: link.id,
      fileId: targetFile.id,
      documentHash: targetFile.signature,
      details: {
        shareLinkId: link.id,
        fileId: targetFile.id,
        fileName: targetFile.fileName,
        bundleSize: allFiles.length,
        downloadCount: link.downloadCount + 1,
        transferMode: link.transferMode,
        riskScore: policyResult.riskAssessment.score,
      },
    });

    // Evaluate access telemetry with AI security engine
    await evaluateAccessThreat({
      ipAddress: ip,
      action: "DOWNLOAD",
      details: { fileSizeMb: targetFile.fileSize / (1024 * 1024) },
    });

    // Read the encrypted file bytes
    const fileBuffer = fs.readFileSync(filePath);

    // Safely unwrap Data Encryption Key (DEK) via KMS for authorized recipient
    let unwrappedDekHex: string | null = null;
    if (targetFile.encryptedKeyPackage) {
      try {
        const { unwrapDEK } = await import("@/lib/kms");
        unwrappedDekHex = unwrapDEK(targetFile.encryptedKeyPackage);
      } catch (keyErr) {
        console.error("Failed to unwrap DEK during authorized download:", keyErr);
      }
    }

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": fileBuffer.length.toString(),
        "Access-Control-Expose-Headers": "x-file-id, x-file-name, x-payload-key, x-original-hash, x-ciphertext-hash, x-encryption-algo, x-encryption-version",
        "x-file-id": targetFile.id,
        ...(targetFile.fileName ? { "x-file-name": targetFile.fileName } : {}),
        ...(unwrappedDekHex ? { "x-payload-key": unwrappedDekHex } : {}),
        ...(targetFile.originalHash ? { "x-original-hash": targetFile.originalHash } : {}),
        ...(targetFile.signature ? { "x-ciphertext-hash": targetFile.signature } : {}),
        ...(targetFile.encryptionAlgo ? { "x-encryption-algo": targetFile.encryptionAlgo } : {}),
        ...(targetFile.encryptionVersion ? { "x-encryption-version": targetFile.encryptionVersion } : {}),
      },
    });
  } catch (error) {
    console.error("Download endpoint error:", error);
    return NextResponse.json({ error: "Failed to download encrypted payload" }, { status: 500 });
  }
}
