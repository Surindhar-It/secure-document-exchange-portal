/**
 * Verification test script for:
 * Secure Email Sharing with Encrypted Passwords
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

// KMS Key derivation helper matching src/lib/kms.ts
const KMS_MASTER_SECRET =
  process.env.KMS_MASTER_KEY ||
  process.env.JWT_SECRET ||
  "fortress-kms-master-key-secure-seed-98234120984124981";

function getMasterKEK() {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(KMS_MASTER_SECRET, "utf-8"),
      Buffer.from("SecureDocX-KMS-Salt-v1", "utf-8"),
      Buffer.from("kek-envelope-derivation", "utf-8"),
      32
    )
  );
}

function encryptSecret(secret) {
  if (!secret) return "";
  const kek = getMasterKEK();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secret, "utf-8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    version: "1.0",
    algorithm: "AES-256-GCM",
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  });
}

function decryptSecret(packageJson) {
  if (!packageJson) return "";
  const pkg = JSON.parse(packageJson);
  const kek = getMasterKEK();
  const iv = Buffer.from(pkg.iv, "hex");
  const authTag = Buffer.from(pkg.authTag, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(pkg.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

async function runTests() {
  console.log("================================================================");
  console.log("TEST SUITE: Secure Email Sharing with Encrypted Passwords");
  console.log("================================================================");

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      process.exitCode = 1;
    }
  }

  // TEST 1: KMS Secret Envelope Encryption & Decryption
  console.log("\n[1] Testing KMS Envelope Encryption for Download Passwords...");
  const rawPassword = "VaultSecretPass_2026!#";
  const encryptedPkg = encryptSecret(rawPassword);
  assert(encryptedPkg && encryptedPkg.includes("AES-256-GCM"), "Password encrypted with AES-256-GCM envelope");
  assert(!encryptedPkg.includes(rawPassword), "Encrypted payload does NOT contain plaintext password");

  const parsedPkg = JSON.parse(encryptedPkg);
  assert(parsedPkg.iv && parsedPkg.iv.length === 24, "12-byte initialization vector (hex) generated");
  assert(parsedPkg.authTag && parsedPkg.authTag.length === 32, "16-byte GCM authentication tag present");

  const decryptedPassword = decryptSecret(encryptedPkg);
  assert(decryptedPassword === rawPassword, "KMS decrypts encrypted password back to exact plaintext");

  // TEST 2: Tamper Resistance
  console.log("\n[2] Testing KMS Tamper Resistance...");
  let tamperThrown = false;
  try {
    const tampered = JSON.parse(encryptedPkg);
    tampered.ciphertext = "ff" + tampered.ciphertext.slice(2);
    decryptSecret(JSON.stringify(tampered));
  } catch (err) {
    tamperThrown = true;
  }
  assert(tamperThrown, "Tampered ciphertext triggers authentication failure (GCM tag check)");

  // TEST 3: Bcrypt One-Way Hashing for Secure Password Validation
  console.log("\n[3] Testing Password Verification Engine (Bcrypt comparison)...");
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(rawPassword, salt);
  const correctMatch = await bcrypt.compare(rawPassword, passwordHash);
  const wrongMatch = await bcrypt.compare("WrongPassword_123", passwordHash);
  assert(correctMatch === true, "Correct password matches bcrypt hash");
  assert(wrongMatch === false, "Incorrect password rejected by bcrypt comparison");

  // TEST 4: Supabase Database Schema Persistence
  console.log("\n[4] Testing Supabase DB Schema & Link Creation with Encrypted Password...");
  const testUser = await prisma.user.findFirst();
  const testFile = await prisma.fileMetadata.findFirst();

  if (testUser && testFile) {
    const testLinkId = "test-email-share-" + Date.now().toString(36);
    const createdLink = await prisma.shareLink.create({
      data: {
        id: testLinkId,
        fileId: testFile.id,
        ownerId: testUser.id,
        transferMode: "STANDARD",
        authMethod: "BOTH",
        recipientEmail: "test-recipient@example.com",
        status: "ACTIVE",
        passwordHash,
        encryptedPassword: encryptedPkg,
        emailNotificationSent: true,
        emailDeliveryMode: "SEPARATE",
        otpEnabled: true,
      },
    });

    assert(createdLink.id === testLinkId, "Created test ShareLink record in Supabase");
    assert(createdLink.encryptedPassword !== null, "encryptedPassword field persisted in Supabase");
    assert(createdLink.emailNotificationSent === true, "emailNotificationSent field persisted in Supabase");
    assert(createdLink.emailDeliveryMode === "SEPARATE", "emailDeliveryMode field persisted in Supabase");

    // Recover from DB and test backend decryption
    const fetchedLink = await prisma.shareLink.findUnique({ where: { id: testLinkId } });
    const recoveredPassword = decryptSecret(fetchedLink.encryptedPassword);
    assert(recoveredPassword === rawPassword, "Backend recovered correct cleartext password for email dispatch");

    // Clean up test link
    await prisma.shareLink.delete({ where: { id: testLinkId } });
    console.log("  [INFO] Cleaned up temporary test record from Supabase.");
  } else {
    console.log("  [WARN] Skipping DB integration test: no existing user or file in DB.");
  }

  // Summary
  console.log("\n================================================================");
  console.log(`TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("================================================================\n");

  await prisma.$disconnect();
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
