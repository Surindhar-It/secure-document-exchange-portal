import crypto from "crypto";

/**
 * Key Management Service (KMS) for Secure Document Exchange Portal (SecureDocX)
 * Implements envelope encryption for Data Encryption Keys (DEKs).
 * Raw encryption keys are NEVER stored in the database, logs, URLs, or on-chain.
 */

const KMS_MASTER_SECRET =
  process.env.KMS_MASTER_KEY ||
  process.env.JWT_SECRET ||
  "fortress-kms-master-key-secure-seed-98234120984124981";

// Derive 256-bit Key Encryption Key (KEK) using HKDF
function getMasterKEK(): Buffer {
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

export interface EncryptedKeyPackage {
  version: string;
  algorithm: string;
  iv: string; // 12-byte IV in hex
  authTag: string; // 16-byte authentication tag in hex
  ciphertext: string; // Wrapped DEK in hex
}

/**
 * Wraps a Data Encryption Key (DEK) using the KMS Master KEK (AES-256-GCM).
 * @param dekHex Raw 64-character hex string of the AES-256 DEK
 * @returns Serialized JSON string of the EncryptedKeyPackage
 */
export function wrapDEK(dekHex: string): string {
  if (!dekHex || dekHex.length !== 64) {
    throw new Error("Invalid DEK: expected 64-character (256-bit) hex string");
  }

  const kek = getMasterKEK();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(dekHex, "hex")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const pkg: EncryptedKeyPackage = {
    version: "1.0",
    algorithm: "AES-256-GCM",
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };

  return JSON.stringify(pkg);
}

/**
 * Unwraps an EncryptedKeyPackage back to the 64-character DEK hex string.
 * @param packageJson Serialized JSON string of the EncryptedKeyPackage
 * @returns Raw 64-character hex string of the AES-256 DEK
 */
export function unwrapDEK(packageJson: string): string {
  try {
    const pkg: EncryptedKeyPackage = JSON.parse(packageJson);
    if (pkg.algorithm !== "AES-256-GCM" || !pkg.iv || !pkg.authTag || !pkg.ciphertext) {
      throw new Error("Malformed or unsupported key package format");
    }

    const kek = getMasterKEK();
    const iv = Buffer.from(pkg.iv, "hex");
    const authTag = Buffer.from(pkg.authTag, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(pkg.ciphertext, "hex")),
      decipher.final(),
    ]);

    return decrypted.toString("hex");
  } catch (error) {
    throw new Error("Failed to unwrap DEK: verification failed or invalid key package");
  }
}

/**
 * Derives a link-scoped key verification token or verification signature
 * without disclosing the raw DEK.
 */
export function generateKeyVerificationToken(dekHex: string, linkId: string): string {
  return crypto
    .createHmac("sha256", Buffer.from(dekHex, "hex"))
    .update(`link-auth-token::${linkId}`)
    .digest("hex");
}

/**
 * Reversibly encrypts an arbitrary secret (such as a recipient download password)
 * using the KMS Master Key (AES-256-GCM envelope).
 * Plaintext passwords are never stored in the database.
 */
export function encryptSecret(secret: string): string {
  if (!secret) return "";
  const kek = getMasterKEK();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secret, "utf-8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const pkg: EncryptedKeyPackage = {
    version: "1.0",
    algorithm: "AES-256-GCM",
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };

  return JSON.stringify(pkg);
}

/**
 * Decrypts a secret previously encrypted with encryptSecret using the KMS Master Key.
 * Only executed securely on the backend when re-dispatching credentials.
 */
export function decryptSecret(packageJson: string): string {
  if (!packageJson) return "";
  try {
    const pkg: EncryptedKeyPackage = JSON.parse(packageJson);
    if (pkg.algorithm !== "AES-256-GCM" || !pkg.iv || !pkg.authTag || !pkg.ciphertext) {
      throw new Error("Malformed or unsupported secret package format");
    }

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
  } catch (error) {
    throw new Error("Failed to decrypt secret: verification failed or invalid secret package");
  }
}

/**
 * Converts an EncryptedKeyPackage JSON to a compact hexadecimal cipher token
 * e.g. iv (24 hex) + authTag (32 hex) + ciphertext (hex)
 */
export function toCipherToken(packageJson: string): string {
  if (!packageJson) return "";
  try {
    const pkg: EncryptedKeyPackage = JSON.parse(packageJson);
    return `${pkg.iv}${pkg.authTag}${pkg.ciphertext}`;
  } catch {
    return Buffer.from(packageJson, "utf-8").toString("hex");
  }
}

/**
 * Decrypts either a JSON package string or a compact hex cipher token
 */
export function decryptSecretToken(tokenOrJson: string): string {
  if (!tokenOrJson) return "";
  const trimmed = tokenOrJson.trim();

  // If direct JSON
  if (trimmed.startsWith("{")) {
    return decryptSecret(trimmed);
  }

  // If compact hex: iv(24) + authTag(32) + ciphertext
  if (/^[0-9a-fA-F]{56,}$/.test(trimmed)) {
    try {
      const iv = trimmed.substring(0, 24);
      const authTag = trimmed.substring(24, 56);
      const ciphertext = trimmed.substring(56);
      const pkg: EncryptedKeyPackage = {
        version: "1.0",
        algorithm: "AES-256-GCM",
        iv,
        authTag,
        ciphertext,
      };
      return decryptSecret(JSON.stringify(pkg));
    } catch {
      try {
        const decoded = Buffer.from(trimmed, "hex").toString("utf-8");
        return decryptSecret(decoded);
      } catch {}
    }
  }

  return decryptSecret(trimmed);
}

