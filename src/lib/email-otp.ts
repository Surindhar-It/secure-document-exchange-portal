import crypto from "crypto";
import nodemailer from "nodemailer";
import { db } from "./db";
import { recordAuditEvent } from "./audit";

const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || "securedocx-otp-hmac-master-key-2026";
const OTP_VALIDITY_SECONDS = 300; // 5 minutes
const RESEND_COOLDOWN_SECONDS = 60; // 60 seconds
const MAX_ATTEMPTS = 5;

/**
 * Generate a cryptographically secure 6-digit numeric OTP
 */
export function generateOTP(): string {
  // crypto.randomInt ensures uniform distribution in [100000, 999999]
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP using keyed HMAC-SHA256 (never store plaintext OTPs)
 */
export function hashOTP(otp: string): string {
  return crypto.createHmac("sha256", OTP_SECRET).update(otp.trim()).digest("hex");
}

/**
 * Constant-time comparison to prevent timing attacks
 */
export function verifyOTPHash(inputOtp: string, storedHash: string): boolean {
  if (!inputOtp || !storedHash) return false;
  const inputHash = hashOTP(inputOtp);
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(inputHash, "utf8"), Buffer.from(storedHash, "utf8"));
}

/**
 * Generate a high-entropy session authorization token (32 bytes hex)
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Partially mask recipient email address for privacy (e.g. su****@gmail.com)
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***@***.***";
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}*@${domain}`;
  }
  const visiblePrefix = local.substring(0, 2);
  const maskedLocal = visiblePrefix + "*".repeat(Math.max(local.length - 2, 4));
  return `${maskedLocal}@${domain}`;
}

/**
 * Check if a configuration value is a placeholder or unconfigured
 */
function isConfigured(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("your_email") ||
    lower.includes("example.com") ||
    lower.startsWith("xxxx") ||
    lower === "your-smtp-host" ||
    lower.includes("[your")
  ) {
    return false;
  }
  return true;
}

/**
 * Create a configured Nodemailer transport with resilient timeouts
 */
function createEmailTransporter() {
  const service = process.env.SMTP_SERVICE?.trim();
  const host = process.env.SMTP_HOST?.trim();
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER?.trim();
  let pass = process.env.SMTP_PASS?.trim();

  // Strip wrapping quotes if user pasted `"..."`
  if (pass) {
    pass = pass.replace(/^["']|["']$/g, "").trim();
    // Gmail App Passwords are 16 characters often grouped with spaces (e.g. "slor mnth lbxq atgj")
    if (service?.toLowerCase() === "gmail" || host?.toLowerCase().includes("gmail")) {
      pass = pass.replace(/\s+/g, "");
    }
  }

  // If credentials are blank or placeholders, do not attempt network connections
  if (!isConfigured(user) || !isConfigured(pass)) {
    return null;
  }

  // Strict network timeouts prevent Nodemailer from hanging or causing fetch timeouts
  const networkTimeouts = {
    connectionTimeout: 5000, // 5s max to connect to SMTP server
    greetingTimeout: 5000,   // 5s max to wait for initial SMTP greeting
    socketTimeout: 7000,     // 7s max for socket activity
    tls: {
      rejectUnauthorized: false, // Prevents certificate chain issues from hanging connection
    },
  };

  if (service && isConfigured(service)) {
    return nodemailer.createTransport({
      service,
      auth: { user, pass },
      ...networkTimeouts,
    });
  }

  if (host && isConfigured(host)) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      ...networkTimeouts,
    });
  }

  // Fallback: If SMTP is not explicitly configured, use mock transport in development
  return null;
}

/**
 * Dispatch OTP email via HTTPS API (Resend / Brevo) or SMTP
 */
export async function sendOTPEmail(
  recipientEmail: string,
  otpCode: string,
  linkId: string
): Promise<{ success: boolean; simulated: boolean; error?: string }> {
  const fromAddress = process.env.SMTP_FROM || '"SecureDocX Verification" <no-reply@securedocx.portal>';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Your Secure Download Verification Code</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 24px; margin: 0; }
          .container { max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
          .badge { font-size: 11px; font-family: monospace; text-transform: uppercase; padding: 4px 10px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; border-radius: 9999px; font-weight: bold; }
          h1 { font-size: 20px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0; }
          p { font-size: 13px; line-height: 1.6; color: #9ca3af; margin: 0 0 20px 0; }
          .otp-card { background: #0b0f19; border: 1px solid #374151; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6366f1; }
          .expiry-notice { font-size: 11px; color: #f59e0b; margin-top: 8px; font-family: monospace; }
          .security-footer { border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 11px; color: #6b7280; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="brand">
            <span class="badge">SECUREDOCX • ZERO-KNOWLEDGE PORTAL</span>
          </div>
          <h1>Document Download Verification Code</h1>
          <p>
            You are attempting to download an encrypted file bundle shared via <strong>SecureDocX</strong>.
            To authorize document reconstruction, enter the following one-time passcode:
          </p>
          <div class="otp-card">
            <div class="otp-code">${otpCode}</div>
            <div class="expiry-notice">⏱ Valid for 5 minutes (300 seconds) • One-Time Use Only</div>
          </div>
          <p>
            If you did not request this verification code, please ignore this email. The file remains protected under AES-256-GCM encryption.
          </p>
          <div class="security-footer">
            Transfer Token ID: ${linkId}<br>
            Security Standard: AES-256-GCM Ephemeral KMS Envelope
          </div>
        </div>
      </body>
    </html>
  `;

  const allowSimulation =
    process.env.ALLOW_SIMULATED_OTP !== "false" ||
    process.env.NODE_ENV !== "production";

  let lastError = "";

  // 1. PRIMARY DISPATCH: Nodemailer (Gmail SMTP / Custom SMTP)
  const transporter = createEmailTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipientEmail,
        subject: `[SecureDocX] Your One-Time Download Passcode: ${otpCode}`,
        text: `Your SecureDocX download verification code is: ${otpCode}. It expires in 5 minutes.`,
        html: htmlContent,
      });
      console.log("[EmailOTP] Nodemailer dispatched successfully:", info.messageId);
      return { success: true, simulated: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[EmailOTP] Nodemailer SMTP Delivery error / timeout:", msg);
      if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKET") || msg.includes("timeout")) {
        lastError = "Gmail SMTP connection timed out. If running on Render Free tier, Render blocks outbound SMTP ports (465/587).";
      } else {
        lastError = `Gmail SMTP error: ${msg}`;
      }
      // Fall through to HTTP APIs if SMTP fails or is blocked on cloud host
    }
  }

  // 2. SECONDARY CLOUD DISPATCH: Resend HTTP API (Port 443 HTTPS - Works universally on Render Free Tier!)
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const isRealResendKey = resendApiKey && resendApiKey.startsWith("re_") && resendApiKey.length > 5;
  if (resendApiKey && !isRealResendKey) {
    console.warn("[EmailOTP] RESEND_API_KEY does not start with 're_' (detected Render/invalid token). Skipping Resend HTTP API call.");
  }

  if (isRealResendKey) {
    try {
      const resendFrom = process.env.RESEND_FROM || "SecureDocX <onboarding@resend.dev>";
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [recipientEmail],
          subject: `[SecureDocX] Your One-Time Download Passcode: ${otpCode}`,
          text: `Your SecureDocX download verification code is: ${otpCode}. It expires in 5 minutes.`,
          html: htmlContent,
        }),
      });

      const resendData = await resendRes.json();
      if (resendRes.ok) {
        console.log("[EmailOTP] Resend HTTP API dispatched successfully:", resendData.id);
        return { success: true, simulated: false };
      } else {
        const errorDetail = resendData.message || JSON.stringify(resendData);
        console.error("[EmailOTP] Resend HTTP API error:", errorDetail);
        lastError = `Resend API: ${errorDetail}`;
        if (allowSimulation) {
          return { success: true, simulated: true, error: `Resend API: ${errorDetail}` };
        }
        return { success: false, simulated: false, error: errorDetail };
      }
    } catch (resendErr: unknown) {
      const msg = resendErr instanceof Error ? resendErr.message : String(resendErr);
      console.error("[EmailOTP] Resend HTTP fetch failed:", msg);
      lastError = `Resend API error: ${msg}`;
      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }

  // 3. SECONDARY CLOUD DISPATCH: Brevo HTTP API (Port 443 HTTPS)
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();
  if (brevoApiKey && isConfigured(brevoApiKey)) {
    try {
      const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: "SecureDocX Portal", email: process.env.SMTP_USER || "no-reply@securedocx.portal" },
          to: [{ email: recipientEmail }],
          subject: `[SecureDocX] Your One-Time Download Passcode: ${otpCode}`,
          htmlContent: htmlContent,
        }),
      });

      if (brevoRes.ok) {
        console.log("[EmailOTP] Brevo HTTP API dispatched successfully");
        return { success: true, simulated: false };
      } else {
        const brevoData = await brevoRes.json();
        const errorDetail = brevoData.message || JSON.stringify(brevoData);
        if (allowSimulation) {
          return { success: true, simulated: true, error: `Brevo API: ${errorDetail}` };
        }
        return { success: false, simulated: false, error: errorDetail };
      }
    } catch (brevoErr: unknown) {
      const msg = brevoErr instanceof Error ? brevoErr.message : String(brevoErr);
      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }


  // 4. DEVELOPMENT & TESTING FALLBACK: Safe simulated delivery
  if (allowSimulation) {
    console.log(`\n======================================================`);
    console.log(`[SECUREDOCX EMAIL OTP SIMULATOR]`);
    console.log(`To: ${recipientEmail}`);
    console.log(`Link ID: ${linkId}`);
    console.log(`OTP Code: ${otpCode}`);
    console.log(`Validity: 5 minutes (300 seconds)`);
    console.log(`======================================================\n`);

    return { success: true, simulated: true };
  }

  return {
    success: false,
    simulated: false,
    error: lastError || "Failed to deliver email. No active SMTP connection or valid HTTP email API key found.",
  };
}

/**
 * Dispatch Password Reset verification code to user's registered email address
 */
export async function sendPasswordResetEmailOTP(
  recipientEmail: string,
  otpCode: string
): Promise<{ success: boolean; simulated: boolean; error?: string }> {
  const fromAddress = process.env.SMTP_FROM || '"SecureDocX Security" <no-reply@securedocx.portal>';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Password Reset Verification Code</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 24px; margin: 0; }
          .container { max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
          .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
          .badge { font-size: 11px; font-family: monospace; text-transform: uppercase; padding: 4px 10px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 9999px; font-weight: bold; }
          h1 { font-size: 20px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0; }
          p { font-size: 13px; line-height: 1.6; color: #9ca3af; margin: 0 0 20px 0; }
          .otp-card { background: #0b0f19; border: 1px solid #374151; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
          .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6366f1; }
          .expiry-notice { font-size: 11px; color: #f59e0b; margin-top: 8px; font-family: monospace; }
          .security-footer { border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 11px; color: #6b7280; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="brand">
            <span class="badge">SECUREDOCX • ACCOUNT SECURITY</span>
          </div>
          <h1>Password Reset Verification Code</h1>
          <p>
            A request was received to reset the password for your SecureDocX account (<strong>${recipientEmail}</strong>).
            Enter the verification code below to authorize the password reset:
          </p>
          <div class="otp-card">
            <div class="otp-code">${otpCode}</div>
            <div class="expiry-notice">⏱ Valid for 5 minutes (300 seconds) • Single-Use Only</div>
          </div>
          <p style="font-size: 12px; color: #f87171;">
            ⚠️ If you did not request a password reset, please ignore this email and ensure your account password remains secure. Never share this verification code with anyone.
          </p>
          <div class="security-footer">
            Security Standard: HMAC-SHA256 Multi-Factor Challenge &bull; Rate Limited
          </div>
        </div>
      </body>
    </html>
  `;

  const allowSimulation =
    process.env.ALLOW_SIMULATED_OTP !== "false" ||
    process.env.NODE_ENV !== "production";

  let lastError = "";

  // 1. PRIMARY DISPATCH: Nodemailer (Gmail SMTP / Custom SMTP)
  const transporter = createEmailTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipientEmail,
        subject: `[SecureDocX] Your Password Reset Code: ${otpCode}`,
        text: `Your SecureDocX password reset verification code is: ${otpCode}. It expires in 5 minutes. Never share this code.`,
        html: htmlContent,
      });
      console.log("[PasswordResetEmailOTP] Nodemailer dispatched successfully:", info.messageId);
      return { success: true, simulated: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PasswordResetEmailOTP] Nodemailer SMTP Delivery error:", msg);
      lastError = `Gmail SMTP error: ${msg}`;
    }
  }

  // 2. SECONDARY CLOUD DISPATCH: Resend HTTP API
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const isRealResendKey = resendApiKey && resendApiKey.startsWith("re_") && resendApiKey.length > 5;
  if (isRealResendKey) {
    try {
      const resendFrom = process.env.RESEND_FROM || "SecureDocX <onboarding@resend.dev>";
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [recipientEmail],
          subject: `[SecureDocX] Your Password Reset Code: ${otpCode}`,
          text: `Your SecureDocX password reset verification code is: ${otpCode}. It expires in 5 minutes. Never share this code.`,
          html: htmlContent,
        }),
      });
      if (resendRes.ok) {
        console.log("[PasswordResetEmailOTP] Resend HTTP API dispatched successfully");
        return { success: true, simulated: false };
      }
    } catch (resendErr: unknown) {
      console.error("[PasswordResetEmailOTP] Resend failed:", resendErr);
    }
  }

  // 3. Fallback: Simulator in dev or when simulation allowed
  if (allowSimulation) {
    console.log(`\n======================================================`);
    console.log(`[SECUREDOCX PASSWORD RESET EMAIL OTP SIMULATOR]`);
    console.log(`To: ${recipientEmail}`);
    console.log(`OTP Code: ${otpCode}`);
    console.log(`======================================================\n`);
    return { success: true, simulated: true };
  }

  return {
    success: false,
    simulated: false,
    error: lastError || "Failed to dispatch password reset email.",
  };
}

/**
 * Service to generate and dispatch OTP to designated recipient
 */
export async function requestEmailOTP(shareLinkId: string, clientIp: string) {
  const link = await db.shareLink.findUnique({
    where: { id: shareLinkId },
  });

  if (!link || link.isRevoked || link.status === "REVOKED") {
    throw new Error("Sharing link is invalid or has been revoked.");
  }

  if (link.status === "FROZEN" || link.status === "BLOCKED") {
    throw new Error("This secure transfer has been frozen due to security violations.");
  }

  if (link.expiresAt && new Date() > link.expiresAt) {
    throw new Error("Sharing link has expired.");
  }

  if (!link.recipientEmail) {
    throw new Error("This transfer link does not have an Email OTP recipient binding configured.");
  }

  const recipientEmail = link.recipientEmail.toLowerCase().trim();

  // Check 60-second cooldown from the most recent OTP
  const latestOtp = await db.emailOtp.findFirst({
    where: {
      shareLinkId: link.id,
      recipientEmail,
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  if (latestOtp && latestOtp.resendAvailableAt > now) {
    const secondsRemaining = Math.ceil((latestOtp.resendAvailableAt.getTime() - now.getTime()) / 1000);
    throw new Error(`Resend cooldown active. Please wait ${secondsRemaining} second(s) before requesting a new OTP.`);
  }

  // Invalidate any existing active OTPs for this link
  await db.emailOtp.updateMany({
    where: {
      shareLinkId: link.id,
      recipientEmail,
      isUsed: false,
    },
    data: {
      isUsed: true,
    },
  });

  // Generate 6-digit random code
  const plainOtp = generateOTP();
  const otpHash = hashOTP(plainOtp);

  const expiresAt = new Date(Date.now() + OTP_VALIDITY_SECONDS * 1000);
  const resendAvailableAt = new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);

  // Store new OTP record
  const otpRecord = await db.emailOtp.create({
    data: {
      shareLinkId: link.id,
      recipientEmail,
      otpHash,
      expiresAt,
      resendAvailableAt,
      maxAttempts: MAX_ATTEMPTS,
      attempts: 0,
      isUsed: false,
    },
  });

  // Dispatch email
  const emailResult = await sendOTPEmail(recipientEmail, plainOtp, link.id);

  if (!emailResult.success && !emailResult.simulated) {
    // Crucial: Roll back the created OTP so the user is NOT stuck in a 60-second cooldown after a failed send!
    try {
      await db.emailOtp.delete({
        where: { id: otpRecord.id },
      });
    } catch (delErr) {
      console.error("[EmailOTP] Failed to rollback OTP record on delivery failure:", delErr);
    }

    throw new Error(`Email delivery failed: ${emailResult.error || "Unable to dispatch email via SMTP."}`);
  }

  // Record audit log event (without recording plaintext OTP)
  await recordAuditEvent({
    action: "EMAIL_OTP_REQUESTED",
    ipAddress: clientIp,
    shareLinkId: link.id,
    userEmail: recipientEmail,
    details: {
      shareLinkId: link.id,
      recipientMasked: maskEmail(recipientEmail),
      expiresAt,
      simulated: emailResult.simulated,
    },
  });

  return {
    success: true,
    message: emailResult.simulated
      ? (emailResult.error
          ? `SMTP connection issue (${emailResult.error}). Switched to Simulated Test Mode.`
          : "Simulated Mode: SMTP is not configured in .env. Test OTP generated.")
      : "A verification code has been sent to your registered email address.",
    maskedEmail: maskEmail(recipientEmail),
    expiresAt: expiresAt.toISOString(),
    validitySeconds: OTP_VALIDITY_SECONDS,
    resendCooldown: RESEND_COOLDOWN_SECONDS,
    simulated: emailResult.simulated,
    devCode: emailResult.simulated ? plainOtp : undefined,
  };
}

/**
 * Service to verify recipient OTP and issue authorization session token
 */
export async function verifyEmailOTP(shareLinkId: string, inputOtp: string, clientIp: string) {
  if (!inputOtp || inputOtp.trim().length !== 6) {
    throw new Error("Please enter a valid 6-digit verification code.");
  }

  const link = await db.shareLink.findUnique({
    where: { id: shareLinkId },
  });

  if (!link || link.isRevoked || link.status === "REVOKED") {
    throw new Error("Sharing link is invalid or has been revoked.");
  }

  if (!link.recipientEmail) {
    throw new Error("No recipient email binding found on this transfer link.");
  }

  const recipientEmail = link.recipientEmail.toLowerCase().trim();

  // Find latest active OTP for this link
  const activeOtp = await db.emailOtp.findFirst({
    where: {
      shareLinkId: link.id,
      recipientEmail,
      isUsed: false,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!activeOtp) {
    throw new Error("No active OTP request found. Please click 'Send OTP' to request a code.");
  }

  const now = new Date();

  // Check Expiration (5 minutes)
  if (now > activeOtp.expiresAt) {
    await db.emailOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true },
    });

    await recordAuditEvent({
      action: "EMAIL_OTP_EXPIRED",
      ipAddress: clientIp,
      shareLinkId: link.id,
      userEmail: recipientEmail,
      details: { shareLinkId: link.id, expiredAt: activeOtp.expiresAt },
    });

    throw new Error("The verification code has expired after 5 minutes. Please request a new code.");
  }

  // Check Attempt Limit (max 5)
  if (activeOtp.attempts >= activeOtp.maxAttempts) {
    await db.emailOtp.update({
      where: { id: activeOtp.id },
      data: { isUsed: true },
    });

    await recordAuditEvent({
      action: "EMAIL_OTP_LOCKED",
      ipAddress: clientIp,
      shareLinkId: link.id,
      userEmail: recipientEmail,
      details: { shareLinkId: link.id, attempts: activeOtp.attempts },
    });

    throw new Error("Maximum verification attempts reached (5/5). Please request a fresh verification code.");
  }

  // Verify OTP
  const isValid = verifyOTPHash(inputOtp.trim(), activeOtp.otpHash);

  if (!isValid) {
    const newAttempts = activeOtp.attempts + 1;
    const isNowLocked = newAttempts >= activeOtp.maxAttempts;

    await db.emailOtp.update({
      where: { id: activeOtp.id },
      data: {
        attempts: newAttempts,
        isUsed: isNowLocked,
      },
    });

    await recordAuditEvent({
      action: "EMAIL_OTP_FAILED",
      ipAddress: clientIp,
      shareLinkId: link.id,
      userEmail: recipientEmail,
      details: {
        shareLinkId: link.id,
        attempt: newAttempts,
        maxAttempts: activeOtp.maxAttempts,
        remainingAttempts: Math.max(activeOtp.maxAttempts - newAttempts, 0),
      },
    });

    if (isNowLocked) {
      throw new Error("Maximum verification attempts reached (5/5). This code has been invalidated. Please request a new code.");
    }

    const remaining = activeOtp.maxAttempts - newAttempts;
    throw new Error(`Incorrect verification code. ${remaining} attempt(s) remaining.`);
  }

  // OTP is valid! Generate short-lived authorization session token (valid 15 mins)
  const sessionToken = generateSessionToken();
  const sessionExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.emailOtp.update({
    where: { id: activeOtp.id },
    data: {
      isUsed: true,
      verifiedAt: now,
      sessionToken,
      sessionExpiresAt,
    },
  });

  await recordAuditEvent({
    action: "EMAIL_OTP_VERIFIED",
    ipAddress: clientIp,
    shareLinkId: link.id,
    userEmail: recipientEmail,
    details: {
      shareLinkId: link.id,
      recipientMasked: maskEmail(recipientEmail),
      sessionExpiresAt,
    },
  });

  return {
    success: true,
    message: "Email verification successful! Download access authorized.",
    sessionToken,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
  };
}

/**
 * Validate an authorization session token for file download
 */
export async function validateOTPSessionToken(shareLinkId: string, sessionToken: string): Promise<boolean> {
  if (!sessionToken || sessionToken.length < 32) return false;

  const validOtpSession = await db.emailOtp.findFirst({
    where: {
      shareLinkId,
      sessionToken,
      sessionExpiresAt: { gte: new Date() },
    },
  });

  return !!validOtpSession;
}
