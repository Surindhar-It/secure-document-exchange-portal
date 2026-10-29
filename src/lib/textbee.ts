import crypto from "crypto";

const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || "securedocx-textbee-sms-hmac-salt-2026";

/**
 * Standardize phone number format for SMS dispatch
 * Ensures E.164-compatible international format (e.g. +919876543210 or +12025550123)
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, "").trim();
  if (!cleaned.startsWith("+")) {
    // If 11 digits starting with 0 (e.g. 09876543210), strip 0 and default to +91
    if (cleaned.length === 11 && cleaned.startsWith("0")) {
      cleaned = "+91" + cleaned.slice(1);
    } else if (cleaned.length === 10) {
      // 10 digits default to India +91 prefix
      cleaned = "+91" + cleaned;
    } else {
      cleaned = "+" + cleaned;
    }
  }
  return cleaned;
}

/**
 * Mask phone number for safe, privacy-preserving frontend display
 * e.g. "+919876543210" -> "+91******3210"
 */
export function maskPhoneNumber(phone: string): string {
  const formatted = formatPhoneNumber(phone);
  if (formatted.length <= 6) return formatted;
  const prefix = formatted.slice(0, 3);
  const suffix = formatted.slice(-4);
  const maskedCount = Math.max(formatted.length - 7, 3);
  return `${prefix}${"*".repeat(maskedCount)}${suffix}`;
}

/**
 * Generate cryptographically random 6-digit numeric OTP
 */
export function generateSMSOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash SMS OTP with HMAC-SHA256 (Never store plaintext OTP in database)
 */
export function hashSMSOTP(otp: string): string {
  return crypto.createHmac("sha256", OTP_SECRET).update(otp.trim()).digest("hex");
}

/**
 * Constant-time OTP comparison
 */
export function verifySMSOTPHash(inputOtp: string, storedHash: string): boolean {
  if (!inputOtp || !storedHash) return false;
  const inputHash = hashSMSOTP(inputOtp);
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(inputHash, "utf8"), Buffer.from(storedHash, "utf8"));
}

/**
 * Generate 32-byte cryptographically secure reset token
 */
export function generateResetSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface SendSMSResult {
  success: boolean;
  simulated: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Dispatches an SMS via TextBee Gateway REST API (api.textbee.dev)
 */
export async function sendTextBeeSMS(
  toPhone: string,
  message: string
): Promise<SendSMSResult> {
  const formattedPhone = formatPhoneNumber(toPhone);
  const apiKey = process.env.TEXTBEE_API_KEY?.trim();
  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
  const allowSimulation =
    process.env.ALLOW_SIMULATED_SMS !== "false" ||
    process.env.NODE_ENV !== "production";

  // Check if TextBee API Key is configured and not a placeholder
  const isKeyConfigured =
    apiKey &&
    !apiKey.includes("YOUR_") &&
    !apiKey.includes("xxxx") &&
    apiKey.length > 5;

  if (isKeyConfigured) {
    try {
      const payload: Record<string, any> = {
        recipients: [formattedPhone],
        message: message,
      };

      if (deviceId && !deviceId.includes("YOUR_")) {
        payload.deviceId = deviceId;
      }

      const res = await fetch("https://api.textbee.dev/api/v1/gateway/send-sms", {
        method: "POST",
        headers: {
          "x-api-key": apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        console.log("[TextBee SMS] Dispatched successfully:", data);
        return {
          success: true,
          simulated: false,
          messageId: data?.id || data?.messageId || "sent",
        };
      } else {
        const errorMsg = data?.message || JSON.stringify(data) || `HTTP ${res.status}`;
        console.warn("[TextBee SMS] API error response:", errorMsg);

        if (allowSimulation) {
          console.warn("[TextBee SMS] Gracefully falling back to simulated SMS.");
          return {
            success: true,
            simulated: true,
            error: `TextBee API: ${errorMsg}`,
          };
        }
        return { success: false, simulated: false, error: errorMsg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[TextBee SMS] Network error:", msg);

      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }

  // Fallback: Simulated SMS Delivery (for development & testing without live TextBee account)
  console.log(`\n======================================================`);
  console.log(`[TEXTBEE SMS GATEWAY SIMULATOR]`);
  console.log(`To: ${formattedPhone} (${maskPhoneNumber(formattedPhone)})`);
  console.log(`Message: "${message}"`);
  console.log(`Notice: Configure TEXTBEE_API_KEY in .env for live carrier SMS`);
  console.log(`======================================================\n`);

  return { success: true, simulated: true };
}
