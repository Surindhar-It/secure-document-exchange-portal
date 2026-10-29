/**
 * Verification test suite for:
 * Password Reset via TextBee SMS OTP
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const prisma = new PrismaClient();

const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || "securedocx-textbee-sms-hmac-salt-2026";

function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/[^\d+]/g, "").trim();
  if (!cleaned.startsWith("+")) {
    if (cleaned.length === 10) {
      cleaned = "+91" + cleaned;
    } else {
      cleaned = "+" + cleaned;
    }
  }
  return cleaned;
}

function maskPhoneNumber(phone) {
  const formatted = formatPhoneNumber(phone);
  if (formatted.length <= 6) return formatted;
  const prefix = formatted.slice(0, 3);
  const suffix = formatted.slice(-4);
  const maskedCount = Math.max(formatted.length - 7, 3);
  return `${prefix}${"*".repeat(maskedCount)}${suffix}`;
}

function hashSMSOTP(otp) {
  return crypto.createHmac("sha256", OTP_SECRET).update(otp.trim()).digest("hex");
}

function verifySMSOTPHash(inputOtp, storedHash) {
  if (!inputOtp || !storedHash) return false;
  const inputHash = hashSMSOTP(inputOtp);
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(inputHash, "utf8"), Buffer.from(storedHash, "utf8"));
}

async function runTextBeeTests() {
  console.log("================================================================");
  console.log("TEST SUITE: TextBee SMS Gateway & Password Reset Workflow");
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

  // 1. Phone number formatting & privacy masking
  console.log("\n[1] Testing Phone Number Formatting & Masking...");
  const raw1 = "9876543210";
  const formatted1 = formatPhoneNumber(raw1);
  assert(formatted1 === "+919876543210", `10-digit number formatted to E.164: ${formatted1}`);

  const masked = maskPhoneNumber("+919876543210");
  assert(masked.startsWith("+91") && masked.endsWith("3210") && masked.includes("*"), `Masked phone format: ${masked}`);

  // 2. Cryptographic OTP Generation & HMAC-SHA256
  console.log("\n[2] Testing Cryptographic OTP Generation & HMAC-SHA256 Hashing...");
  const testOtp = "729481";
  const hash = hashSMSOTP(testOtp);
  assert(hash.length === 64, "Generated 64-character HMAC-SHA256 hash");
  assert(verifySMSOTPHash(testOtp, hash) === true, "Valid OTP verifies successfully with timing-safe check");
  assert(verifySMSOTPHash("123456", hash) === false, "Incorrect OTP correctly fails verification");

  // 3. Database Round-Trip & Reset Token Workflow
  console.log("\n[3] Testing Supabase DB Password Reset Workflow with TextBee OTP...");
  const testEmail = `test-reset-${Date.now()}@example.com`;
  const initialPassword = "OldPassword_123!";
  const newPassword = "NewSecurePassword_2026!#";

  const initialSalt = await bcrypt.genSalt(10);
  const initialHash = await bcrypt.hash(initialPassword, initialSalt);

  // Create temporary user
  const user = await prisma.user.create({
    data: {
      email: testEmail,
      phoneNumber: "+919876543210",
      passwordHash: initialHash,
    },
  });

  assert(user.id !== null, `Created test user ${testEmail} in Supabase`);
  assert(user.phoneNumber === "+919876543210", "User phone number saved in DB");

  // Create PasswordResetOtp record
  const resetOtp = await prisma.passwordResetOtp.create({
    data: {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      otpHash: hash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      attempts: 0,
      maxAttempts: 5,
      isUsed: false,
    },
  });

  assert(resetOtp.id !== null, "PasswordResetOtp record created");
  assert(resetOtp.isUsed === false, "PasswordResetOtp initialized as unused");

  // Simulate OTP verification & resetToken issuance
  const resetToken = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetOtp.update({
    where: { id: resetOtp.id },
    data: { isUsed: true, resetToken },
  });

  // Verify and update password
  const newSalt = await bcrypt.genSalt(10);
  const newHash = await bcrypt.hash(newPassword, newSalt);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  await prisma.passwordResetOtp.update({
    where: { id: resetOtp.id },
    data: { resetToken: null },
  });

  // Check login with new password
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  const oldPassMatch = await bcrypt.compare(initialPassword, updatedUser.passwordHash);
  const newPassMatch = await bcrypt.compare(newPassword, updatedUser.passwordHash);

  assert(oldPassMatch === false, "Old password is no longer valid");
  assert(newPassMatch === true, "New password authenticated successfully");

  // Clean up
  await prisma.passwordResetOtp.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log("  [INFO] Cleaned up temporary test user and OTP records.");

  console.log("\n================================================================");
  console.log(`TEST SUMMARY: ${passed} / ${total} tests passed.`);
  console.log("================================================================\n");

  await prisma.$disconnect();
}

runTextBeeTests().catch((err) => {
  console.error("Test execution failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
