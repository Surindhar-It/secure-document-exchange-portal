/**
 * Client-Side Cryptographic Utilities using the Web Crypto API.
 * These methods are executed in-browser to enforce a Zero-Knowledge Architecture.
 */

// Helper: Convert ArrayBuffer to Hex String
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Helper: Convert Hex String to ArrayBuffer
export function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

// Helper: Convert ArrayBuffer to Base64
export function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper: Convert Base64 to ArrayBuffer
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper: Convert String to ArrayBuffer (UTF-8)
export function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

// Helper: Convert ArrayBuffer to String (UTF-8)
export function bufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

// 1. Generate an Ephemeral AES-GCM 256-bit Key
export async function generateEncryptionKey(): Promise<CryptoKey> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptography API is only available in browser contexts.");
  }
  return await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

// 2. Export CryptoKey to HEX string for URL incorporation
export async function exportKeyToHex(key: CryptoKey): Promise<string> {
  const rawKey = await window.crypto.subtle.exportKey("raw", key);
  return bufferToHex(rawKey);
}

// 3. Import CryptoKey from HEX string
export async function importKeyFromHex(hexKey: string): Promise<CryptoKey> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptography API is only available in browser contexts.");
  }
  const rawKey = hexToBuffer(hexKey);
  return await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

// 4. Encrypt File ArrayBuffer using AES-GCM 256-bit
// Prepends the 12-byte IV directly to the ciphertext for convenient one-file storage
export async function encryptFileBuffer(
  fileData: ArrayBuffer,
  key: CryptoKey
): Promise<ArrayBuffer> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptography API is only available in browser contexts.");
  }
  // Generate a random 12-byte Initialization Vector (IV)
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    fileData
  );

  // Combine IV and ciphertext: [12 bytes IV][Ciphertext bytes]
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return combined.buffer;
}

// 5. Decrypt combined ArrayBuffer [12 bytes IV][Ciphertext bytes]
export async function decryptFileBuffer(
  combinedData: ArrayBuffer,
  hexKey: string
): Promise<ArrayBuffer> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptography API is only available in browser contexts.");
  }
  const key = await importKeyFromHex(hexKey);
  const dataView = new Uint8Array(combinedData);

  // Extract the first 12 bytes as IV
  const iv = dataView.slice(0, 12);
  // Extract the rest as Ciphertext
  const ciphertext = dataView.slice(12);

  return await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertext.buffer
  );
}

// 6. Compute SHA-256 Hash of an ArrayBuffer in browser
export async function computeSHA256Buffer(buffer: ArrayBuffer): Promise<string> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptography API is only available in browser contexts.");
  }
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(hashBuffer);
}

