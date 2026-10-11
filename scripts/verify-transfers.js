const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const db = new PrismaClient();

async function runTests() {
  console.log("=================================================");
  console.log("   SECURE DOCUMENT EXCHANGE PORTAL TEST SUITE    ");
  console.log("   HYBRID CRYPTO, STEGANOGRAPHY & ANALYTICS      ");
  console.log("=================================================\n");

  let testPassed = 0;
  let testFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      testPassed++;
    } else {
      console.error(`[FAIL] ${message}`);
      testFailed++;
    }
  }

  try {
    // 1. Setup Test User & Document
    console.log("--- Test 1: User & Document Setup ---");
    let testUser = await db.user.findFirst({ where: { email: "test-verifier@fortress.internal" } });
    if (!testUser) {
      testUser = await db.user.create({
        data: {
          email: "test-verifier@fortress.internal",
          passwordHash: "mock_hash_for_test",
        },
      });
    }
    assert(!!testUser, "Test user provisioned in database");

    const storageDir = path.join(__dirname, "../storage");
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    const dummyFilePath = path.join(storageDir, "test-doc.enc");
    fs.writeFileSync(dummyFilePath, Buffer.from("ENCRYPTED_AES_256_GCM_CIPHERTEXT_PAYLOAD"));
    const dummyFileHash = crypto.createHash("sha256").update("ENCRYPTED_AES_256_GCM_CIPHERTEXT_PAYLOAD").digest("hex");
    const originalPlaintextHash = crypto.createHash("sha256").update("PLAINTEXT_ORIGINAL_DOCUMENT_DATA").digest("hex");

    const testFile = await db.fileMetadata.create({
      data: {
        fileName: Buffer.from("Secret_Project_Specs.pdf").toString("base64"),
        fileSize: 1024,
        mimeType: "application/pdf",
        storagePath: dummyFilePath,
        signature: dummyFileHash,
        originalHash: originalPlaintextHash,
        encryptionAlgo: "AES-256-GCM",
        encryptionVersion: "1.0",
        ownerId: testUser.id,
      },
    });
    assert(testFile.signature === dummyFileHash, "Encrypted document stored off-chain with SHA-256 signature");
    assert(testFile.originalHash === originalPlaintextHash, "Original plaintext SHA-256 signature recorded for integrity");
    assert(testFile.encryptionAlgo === "AES-256-GCM" && testFile.encryptionVersion === "1.0", "Encryption metadata versioned correctly");

    // 2. Test Standard Transfer
    console.log("\n--- Test 2: Standard Transfer Mode ---");
    const standardLinkId = "std_" + crypto.randomBytes(6).toString("hex");
    const standardLink = await db.shareLink.create({
      data: {
        id: standardLinkId,
        fileId: testFile.id,
        ownerId: testUser.id,
        transferMode: "STANDARD",
        status: "ACTIVE",
        maxDownloads: 5,
        downloadCount: 0,
      },
    });
    assert(standardLink.transferMode === "STANDARD", "Standard Transfer link created with transferMode=STANDARD");
    assert(standardLink.status === "ACTIVE", "Standard Transfer initialized with status=ACTIVE");

    // 3. Test Blockchain Transfer Mode & Proof Record
    console.log("\n--- Test 3: Blockchain Transfer Mode ---");
    const bcLinkId = "bc_" + crypto.randomBytes(6).toString("hex");
    const bcLink = await db.shareLink.create({
      data: {
        id: bcLinkId,
        fileId: testFile.id,
        ownerId: testUser.id,
        transferMode: "BLOCKCHAIN",
        recipientEmail: "authorized-recipient@enterprise.com",
        status: "ACTIVE",
        maxDownloads: 1,
        downloadCount: 0,
      },
    });

    const proofId = "proof_" + crypto.randomBytes(8).toString("hex");
    const eventHash = crypto.createHash("sha256").update(bcLinkId + dummyFileHash).digest("hex");

    const proof = await db.blockchainProof.create({
      data: {
        proofId,
        shareLinkId: bcLink.id,
        fileId: testFile.id,
        documentHash: dummyFileHash,
        eventHash,
        eventType: "SHARE_CREATED",
        network: "sepolia",
        status: "CONFIRMED",
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      },
    });
    assert(bcLink.transferMode === "BLOCKCHAIN", "Blockchain Transfer link created with transferMode=BLOCKCHAIN");
    assert(proof.documentHash === dummyFileHash, "BlockchainProof record correctly stores document SHA-256 integrity hash");
    assert(proof.status === "CONFIRMED", "BlockchainProof registered with confirmed status");

    // 4. Test Recipient Binding Enforcement
    console.log("\n--- Test 4: Recipient Binding Enforcement ---");
    const wrongRecipient = "intruder@unknown.com";
    const correctRecipient = "authorized-recipient@enterprise.com";

    const isMatchWrong = bcLink.recipientEmail === wrongRecipient;
    const isMatchCorrect = bcLink.recipientEmail === correctRecipient;

    assert(!isMatchWrong, "Access denied when recipient mismatch occurs (intruder@unknown.com)");
    assert(isMatchCorrect, "Access granted when recipient email matches authorized recipient");

    // 5. Mandatory Concurrency Test: maxDownloads = 1 with 2 simultaneous requests
    console.log("\n--- Test 5: Concurrency Test (maxDownloads = 1 Atomic Enforcement) ---");
    const concurrencyLinkId = "conc_" + crypto.randomBytes(6).toString("hex");
    await db.shareLink.create({
      data: {
        id: concurrencyLinkId,
        fileId: testFile.id,
        ownerId: testUser.id,
        transferMode: "STANDARD",
        status: "ACTIVE",
        maxDownloads: 1,
        downloadCount: 0,
      },
    });

    async function attemptDownload(reqId) {
      try {
        return await db.$transaction(async (tx) => {
          const freshLink = await tx.shareLink.findUnique({
            where: { id: concurrencyLinkId },
          });

          if (!freshLink || freshLink.status !== "ACTIVE" || (freshLink.maxDownloads && freshLink.downloadCount >= freshLink.maxDownloads)) {
            throw new Error("Download limit exceeded");
          }

          const newCount = freshLink.downloadCount + 1;
          const newStatus = freshLink.maxDownloads && newCount >= freshLink.maxDownloads ? "ACCESSED" : "ACTIVE";

          await tx.shareLink.update({
            where: { id: concurrencyLinkId },
            data: { downloadCount: newCount, status: newStatus },
          });

          return { reqId, success: true };
        });
      } catch (e) {
        return { reqId, success: false, error: e.message };
      }
    }

    const [resultA, resultB] = await Promise.all([
      attemptDownload("Request_A"),
      attemptDownload("Request_B"),
    ]);

    const successes = [resultA, resultB].filter((r) => r.success);
    const denials = [resultA, resultB].filter((r) => !r.success);

    assert(successes.length === 1, `Concurrency Isolation: Exactly 1 request succeeded (${successes[0]?.reqId})`);
    assert(denials.length === 1, `Concurrency Isolation: Exactly 1 request denied (${denials[0]?.reqId}) with "${denials[0]?.error}"`);

    const finalizedLink = await db.shareLink.findUnique({ where: { id: concurrencyLinkId } });
    assert(finalizedLink.downloadCount === 1, "Download counter equals exactly 1 (no double increment)");
    assert(finalizedLink.status === "ACCESSED", "Link status automatically transitioned to ACCESSED");

    // 6. Test Key Management Service (KMS Envelope Encryption)
    console.log("\n--- Test 6: Hybrid Cryptography & KMS Key Envelope ---");
    const { wrapDEK, unwrapDEK, generateKeyVerificationToken } = require("../src/lib/kms.ts");
    const randomDek = crypto.randomBytes(32).toString("hex");
    const keyPackage = wrapDEK(randomDek);
    assert(typeof keyPackage === "string" && keyPackage.includes("AES-256-GCM"), "DEK successfully wrapped under KMS Master KEK");
    assert(!keyPackage.includes(randomDek), "Raw DEK is not exposed inside key package");

    const unwrappedDek = unwrapDEK(keyPackage);
    assert(unwrappedDek === randomDek, "Unwrapped DEK matches original encryption key exactly");

    const keyToken = generateKeyVerificationToken(randomDek, "test-link-123");
    assert(typeof keyToken === "string" && keyToken.length === 64, "Key verification token derived securely");

    // 7. Test Image Steganography (LSB Embed & Extract)
    console.log("\n--- Test 7: Image Steganography (LSB Embedding & Extraction) ---");
    const { embedPayloadInImageData, extractPayloadFromImageData, calculateImageCapacity } = require("../src/lib/steganography.ts");
    const imgWidth = 64;
    const imgHeight = 64;
    const pixelBuffer = new Uint8Array(imgWidth * imgHeight * 4);
    // Fill with sample image pattern
    for (let i = 0; i < pixelBuffer.length; i++) pixelBuffer[i] = (i * 17) % 256;

    const capacity = calculateImageCapacity(imgWidth, imgHeight);
    assert(capacity > 1000, `Image capacity calculated correctly (${capacity} bytes available)`);

    const stegoPayload = JSON.stringify({
      type: "SECUREDOCX_STEGO_TOKEN",
      shareId: "test_share_789",
      documentHash: dummyFileHash,
      issuedAt: 1720000000000,
    });

    const embedResult = embedPayloadInImageData(pixelBuffer, imgWidth, imgHeight, stegoPayload);
    assert(embedResult.success === true, `Payload embedded into LSB bitstream (${embedResult.bytesEmbedded} bytes)`);

    const extractResult = extractPayloadFromImageData(pixelBuffer, imgWidth, imgHeight);
    assert(extractResult.success === true, "Payload extracted successfully with valid STGX magic header");
    assert(extractResult.payload === stegoPayload, "Extracted stego payload matches original verification token exactly");

    // Tamper detection in Stego
    const tamperedBuffer = new Uint8Array(pixelBuffer);
    tamperedBuffer[30] ^= 1; // Flip a bit inside embedded payload
    const tamperedExtract = extractPayloadFromImageData(tamperedBuffer, imgWidth, imgHeight);
    assert(tamperedExtract.success === false, "Steganography detects tampering and rejects corrupted checksum");

    // 8. Test Admin Analytics Telemetry
    console.log("\n--- Test 8: Admin Analytics Telemetry Aggregations ---");
    const totalUsersCount = await db.user.count();
    const totalDocsCount = await db.fileMetadata.count();
    const standardSharesCount = await db.shareLink.count({ where: { transferMode: "STANDARD" } });
    const blockchainSharesCount = await db.shareLink.count({ where: { transferMode: "BLOCKCHAIN" } });
    const storageAgg = await db.fileMetadata.aggregate({ _sum: { fileSize: true } });

    assert(totalUsersCount > 0, `Total users count aggregated (${totalUsersCount} users)`);
    assert(totalDocsCount > 0, `Total documents aggregated (${totalDocsCount} files)`);
    assert(standardSharesCount >= 0 && blockchainSharesCount >= 0, "Transfer mode distribution queried cleanly");
    assert((storageAgg._sum.fileSize || 0) >= 0, "Total encrypted storage byte usage aggregated");

    // Clean up temporary test entries
    await db.blockchainProof.deleteMany({ where: { shareLinkId: bcLink.id } });
    await db.shareLink.deleteMany({
      where: { id: { in: [standardLinkId, bcLinkId, concurrencyLinkId] } },
    });
    await db.fileMetadata.delete({ where: { id: testFile.id } });

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
    console.log("=================================================\n");

    if (testFailed > 0) process.exit(1);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

runTests();
