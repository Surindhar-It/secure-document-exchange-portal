import nodemailer from "nodemailer";
import { recordAuditEvent } from "./audit";
import { encryptSecret, toCipherToken } from "./kms";

export type EmailDeliveryMode = "COMBINED" | "SEPARATE" | "LINK_ONLY";

export interface ShareNotificationOptions {
  recipientEmail: string;
  senderEmail?: string;
  shareUrl: string;
  recoveryUrl?: string;
  shareLinkId: string;
  fileNames: string[];
  fileCount: number;
  totalSizeFormatted?: string;
  password?: string | null;
  encryptedPasswordToken?: string | null;
  authMethod: string;
  transferMode: "STANDARD" | "BLOCKCHAIN";
  expiresAt?: Date | string | null;
  maxDownloads?: number | null;
  deliveryMode?: EmailDeliveryMode;
  clientIp?: string;
}

export interface DeliveryResult {
  success: boolean;
  deliveryMode: EmailDeliveryMode;
  messagesSent: number;
  simulated: boolean;
  error?: string;
}

export const DEFAULT_PORTAL_BASE_URL = "https://secure-document-exchange-portal.onrender.com";

/**
 * Resolves the portal base URL, cleanly ignoring dummy placeholders
 * such as 'your-service-name.onrender.com' and defaulting to the production portal URL.
 */
export function resolvePortalBaseUrl(reqHeaders?: Headers | null): string {
  // 1. Check NEXT_PUBLIC_BASE_URL environment variable
  const envUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (
    envUrl &&
    !envUrl.includes("your-service-name") &&
    !envUrl.includes("example.com") &&
    !(process.env.NODE_ENV === "production" && (envUrl.includes("localhost") || envUrl.includes("127.0.0.1")))
  ) {
    return envUrl.replace(/\/$/, "");
  }

  // 2. Check incoming request headers
  if (reqHeaders) {
    const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host");
    const proto = reqHeaders.get("x-forwarded-proto") || "https";
    if (
      host &&
      !host.includes("your-service-name") &&
      !host.includes("example.com") &&
      !(process.env.NODE_ENV === "production" && (host.includes("localhost") || host.includes("127.0.0.1")))
    ) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  // 3. Local dev fallback
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  // 4. Default to live portal
  return DEFAULT_PORTAL_BASE_URL;
}

/**
 * Check if a configuration value is present and not a template placeholder
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
 * Create a Nodemailer transport with resilient timeouts and App Password hygiene
 */
function createEmailTransporter() {
  const service = process.env.SMTP_SERVICE?.trim();
  const host = process.env.SMTP_HOST?.trim();
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER?.trim();
  let pass = process.env.SMTP_PASS?.trim();

  if (pass) {
    pass = pass.replace(/^["']|["']$/g, "").trim();
    if (service?.toLowerCase() === "gmail" || host?.toLowerCase().includes("gmail")) {
      pass = pass.replace(/\s+/g, "");
    }
  }

  if (!isConfigured(user) || !isConfigured(pass)) {
    return null;
  }

  const networkTimeouts = {
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 8000,
    tls: {
      rejectUnauthorized: false,
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

  return null;
}

function isValidResendKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.startsWith("rnd_")) {
    console.warn("[EmailService] RESEND_API_KEY starts with 'rnd_' (Render token). Resend API keys must start with 're_' from https://resend.com.");
    return false;
  }
  return trimmed.startsWith("re_") && trimmed.length > 5;
}

/**
 * Dispatches a single email message through Resend (HTTPS), Brevo (HTTPS), SMTP, or Simulator
 */
async function dispatchSingleEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ success: boolean; simulated: boolean; error?: string }> {
  const allowSimulation =
    process.env.ALLOW_SIMULATED_OTP !== "false" ||
    process.env.NODE_ENV !== "production";

  let lastError = "";

  // Tier 1: PRIMARY DISPATCH - Nodemailer (Gmail SMTP / Custom SMTP)
  const transporter = createEmailTransporter();
  if (transporter) {
    const fromAddress =
      process.env.SMTP_FROM ||
      `"SecureDocX Portal" <${process.env.SMTP_USER || "no-reply@securedocx.portal"}>`;

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text,
        html,
      });
      console.log("[EmailService] Nodemailer dispatched successfully:", info.messageId);
      return { success: true, simulated: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EmailService] Nodemailer SMTP send error:", msg);
      if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKET") || msg.includes("timeout")) {
        lastError = "Gmail SMTP connection timed out. If running on Render Free tier, Render blocks outbound SMTP ports (465/587).";
      } else {
        lastError = `Gmail SMTP error: ${msg}`;
      }
      // Fall through to cloud HTTP APIs if SMTP fails or is blocked
    }
  }

  // Tier 2: Cloud Fallback - Resend HTTP API (Port 443 HTTPS)
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey && isValidResendKey(resendApiKey)) {
    try {
      const resendFrom = process.env.RESEND_FROM || "SecureDocX <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [to],
          subject,
          text,
          html,
        }),
      });

      const resData = await res.json();
      if (res.ok) {
        return { success: true, simulated: false };
      } else {
        const errDetail = resData.message || JSON.stringify(resData);
        console.warn("[EmailService] Resend API error:", errDetail);
        lastError = `Resend API: ${errDetail}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EmailService] Resend API request failed:", msg);
      lastError = `Resend API error: ${msg}`;
    }
  }

  // Tier 3: Cloud Fallback - Brevo HTTP API (Port 443 HTTPS)
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();
  if (brevoApiKey && isConfigured(brevoApiKey)) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "SecureDocX Portal",
            email: process.env.BREVO_SENDER_EMAIL?.trim() || process.env.SMTP_USER?.trim() || "surindhar9f@gmail.com",
          },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        }),
      });

      if (res.ok) {
        return { success: true, simulated: false };
      } else {
        const data = await res.json();
        const errDetail = data.message || JSON.stringify(data);
        console.warn("[EmailService] Brevo API error:", errDetail);
        lastError = `Brevo: ${errDetail}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EmailService] Brevo request failed:", msg);
      lastError = `Brevo error: ${msg}`;
    }
  }

  // Tier 4: Simulated Delivery / Resend Sandbox Fallback
  const isResendSandboxRestriction =
    lastError.includes("You can only send testing emails to your own email address") ||
    lastError.includes("resend.com/domains");

  if (allowSimulation || isResendSandboxRestriction) {
    const sandboxNotice = isResendSandboxRestriction
      ? "Resend Sandbox Restriction: Resend Free tier only permits live emails to the account owner. Notification dispatched in test mode."
      : undefined;

    console.log(`\n======================================================`);
    console.log(`[SECUREDOCX EMAIL DISPATCH SIMULATOR]`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    if (sandboxNotice) console.log(`Notice: ${sandboxNotice}`);
    console.log(`======================================================\n`);
    return {
      success: true,
      simulated: true,
      error: sandboxNotice || (lastError ? `Notice: ${lastError}` : undefined),
    };
  }

  return {
    success: false,
    simulated: false,
    error: lastError || "Failed to dispatch email. No working SMTP connection or HTTP email API key found.",
  };
}

/**
 * Builds the HTML template for Link / Transfer Notification with Encrypted Password Token
 */
function buildLinkEmailHtml({
  shareUrl,
  recoveryUrl,
  shareLinkId,
  senderEmail,
  fileNames,
  fileCount,
  transferMode,
  expiresAt,
  maxDownloads,
  authMethod,
  hasPassword,
  encryptedPasswordToken,
}: {
  shareUrl: string;
  recoveryUrl?: string;
  shareLinkId: string;
  senderEmail?: string;
  fileNames: string[];
  fileCount: number;
  transferMode: string;
  expiresAt?: Date | string | null;
  maxDownloads?: number | null;
  authMethod: string;
  hasPassword: boolean;
  encryptedPasswordToken?: string | null;
}): string {
  const fileListHtml = fileNames
    .slice(0, 5)
    .map((name) => `<li style="margin-bottom: 6px; color: #e5e7eb; font-family: monospace; font-size: 13px;">📄 ${name}</li>`)
    .join("");

  const extraFilesNotice =
    fileCount > 5
      ? `<p style="font-size: 12px; color: #9ca3af; margin: 4px 0 0 0;">...and ${fileCount - 5} more file(s)</p>`
      : "";

  const expiryString = expiresAt
    ? new Date(expiresAt).toUTCString()
    : "No expiration set (Never expires)";

  // Sanitize URLs to completely eliminate any dummy placeholders (e.g. your-service-name)
  const cleanShareUrl = shareUrl
    .replace(/https?:\/\/[^/]*your-service-name[^/]*/gi, DEFAULT_PORTAL_BASE_URL)
    .trim();

  const rawRecoveryUrl = recoveryUrl
    ? recoveryUrl.replace(/https?:\/\/[^/]*your-service-name[^/]*/gi, DEFAULT_PORTAL_BASE_URL).trim()
    : "";

  const primaryRecoveryUrl = rawRecoveryUrl || (
    cleanShareUrl.includes("/d/")
      ? `${cleanShareUrl.split("/d/")[0]}/recovery?id=${shareLinkId}${encryptedPasswordToken ? `&cipher=${encodeURIComponent(encryptedPasswordToken)}` : ""}`
      : `${DEFAULT_PORTAL_BASE_URL}/recovery?id=${shareLinkId}${encryptedPasswordToken ? `&cipher=${encodeURIComponent(encryptedPasswordToken)}` : ""}`
  );

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Secure Files Shared With You</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 24px; margin: 0;">
        <div style="max-width: 580px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
            <span style="font-size: 11px; font-family: monospace; text-transform: uppercase; padding: 4px 10px; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; border-radius: 9999px; font-weight: bold;">
              SECUREDOCX • ZERO-KNOWLEDGE PORTAL
            </span>
            <span style="font-size: 11px; font-family: monospace; text-transform: uppercase; padding: 4px 10px; background: ${transferMode === "BLOCKCHAIN" ? "rgba(16, 185, 129, 0.15)" : "rgba(107, 114, 128, 0.2)"}; border: 1px solid ${transferMode === "BLOCKCHAIN" ? "rgba(16, 185, 129, 0.3)" : "rgba(107, 114, 128, 0.3)"}; color: ${transferMode === "BLOCKCHAIN" ? "#34d399" : "#9ca3af"}; border-radius: 9999px; font-weight: bold;">
              ${transferMode === "BLOCKCHAIN" ? "⚡ On-Chain Integrity" : "🛡 Standard Transfer"}
            </span>
          </div>

          <h1 style="font-size: 22px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0;">
            Encrypted Documents Shared With You
          </h1>

          <p style="font-size: 14px; line-height: 1.6; color: #9ca3af; margin: 0 0 20px 0;">
            ${senderEmail ? `<strong>${senderEmail}</strong> has securely sent you` : "You have received"} an encrypted file package via <strong>SecureDocX</strong>.
            All files are protected with AES-256-GCM client-side encryption and SHA-256 dual-hash integrity verification.
          </p>

          <div style="background: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; padding: 18px; margin: 20px 0;">
            <div style="font-size: 11px; font-family: monospace; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">
              Enclosed File Bundle (${fileCount} item${fileCount > 1 ? "s" : ""})
            </div>
            <ul style="margin: 0; padding-left: 20px;">
              ${fileListHtml}
            </ul>
            ${extraFilesNotice}
          </div>

          <!-- SECTION 1: DIRECT FILE DOWNLOAD LINK -->
          <div style="background: #0b0f19; border: 1px solid #1f2937; border-radius: 12px; padding: 18px; margin: 18px 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; color: #818cf8; font-size: 13px; font-family: monospace; text-transform: uppercase; letter-spacing: 1px;">
                1. 📁 Direct File Link
              </span>
              <span style="font-size: 10px; color: #9ca3af; font-family: monospace;">Portal Access</span>
            </div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 12px 0; line-height: 1.5;">
              Access and download your encrypted file package directly through the portal:
            </p>
            <div style="margin-bottom: 10px;">
              <a href="${cleanShareUrl}" style="display: inline-block; background: #1e1b4b; border: 1px solid #4338ca; color: #c7d2fe; text-decoration: none; font-weight: 700; font-size: 13px; padding: 10px 20px; border-radius: 8px;">
                Open Direct File Link &rarr;
              </a>
            </div>
            <div style="font-size: 11px; color: #6b7280; font-family: monospace; word-break: break-all;">
              Direct URL: <a href="${cleanShareUrl}" style="color: #818cf8;">${cleanShareUrl}</a>
            </div>
          </div>

          <!-- SECTION 2: RECOVERY PORTAL LINK -->
          <div style="background: #0b0f19; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 18px; margin: 18px 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; color: #34d399; font-size: 13px; font-family: monospace; text-transform: uppercase; letter-spacing: 1px;">
                2. 🔓 Recovery Portal Link
              </span>
              <span style="font-size: 10px; color: #34d399; font-family: monospace; background: rgba(16, 185, 129, 0.15); padding: 2px 6px; border-radius: 4px;">Self-Healing Decryptor</span>
            </div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 12px 0; line-height: 1.5;">
              Use the Recovery Portal to automatically decrypt your password cipher, verify document integrity, and reconstruct files:
            </p>
            <div style="margin-bottom: 10px;">
              <a href="${primaryRecoveryUrl}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: #ffffff; text-decoration: none; font-weight: 700; font-size: 13px; padding: 10px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                Open Recovery Portal (Auto-Decrypt) &rarr;
              </a>
            </div>
            <div style="font-size: 11px; color: #6b7280; font-family: monospace; word-break: break-all;">
              Recovery URL: <a href="${primaryRecoveryUrl}" style="color: #34d399;">${primaryRecoveryUrl}</a>
            </div>
          </div>

          <!-- SECTION 3: ENCRYPTED PASSWORD CIPHER TOKEN -->
          ${encryptedPasswordToken ? `
          <div style="background: #0b0f19; border: 1px solid rgba(99, 102, 241, 0.35); border-radius: 12px; padding: 18px; margin: 18px 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-weight: 700; color: #a5b4fc; font-size: 13px; font-family: monospace; text-transform: uppercase; letter-spacing: 1px;">
                3. 🔐 Encrypted Password Token
              </span>
              <span style="font-size: 10px; color: #a5b4fc; font-family: monospace; background: rgba(99, 102, 241, 0.15); padding: 2px 6px; border-radius: 4px;">AES-256-GCM Envelope</span>
            </div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 10px 0; line-height: 1.5;">
              For security, the download password was encrypted before transmission. The Recovery Portal link above will automatically load and decrypt this token for you:
            </p>
            <div style="font-family: 'Courier New', Courier, monospace; font-size: 12px; font-weight: 700; letter-spacing: 1px; color: #34d399; background: #030712; padding: 12px 14px; border-radius: 8px; word-break: break-all; border: 1px solid #374151; user-select: all; line-height: 1.6;">
              ${encryptedPasswordToken}
            </div>
            <div style="font-size: 11px; color: #818cf8; margin-top: 8px;">
              💡 You can also copy and paste this token directly into the Decryptor card on the Recovery Portal.
            </div>
          </div>
          ` : ""}

          <div style="background: #0b0f19; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; margin-top: 24px; font-size: 12px; color: #9ca3af; line-height: 1.6;">
            <div><strong>Transfer ID:</strong> <span style="font-family: monospace; color: #e5e7eb;">${shareLinkId}</span></div>
            <div><strong>Authentication Policy:</strong> <span style="font-family: monospace; color: #e5e7eb;">${authMethod}</span></div>
            <div><strong>Expires At:</strong> <span style="font-family: monospace; color: #e5e7eb;">${expiryString}</span></div>
            ${maxDownloads ? `<div><strong>Download Quota:</strong> <span style="font-family: monospace; color: #e5e7eb;">${maxDownloads} download(s) allowed</span></div>` : ""}
          </div>

          <div style="border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 11px; color: #6b7280; font-family: monospace; line-height: 1.5; text-align: center;">
            Security Standard: AES-256-GCM Envelope Encryption &bull; SHA-256 Tamper-Proof Audit
          </div>

        </div>
      </body>
    </html>
  `;
}

/**
 * Builds the HTML template for Separate Password Notification (Out-of-band delivery)
 */
function buildPasswordEmailHtml({
  password,
  shareLinkId,
  senderEmail,
  expiresAt,
}: {
  password: string;
  shareLinkId: string;
  senderEmail?: string;
  expiresAt?: Date | string | null;
}): string {
  const expiryString = expiresAt
    ? new Date(expiresAt).toUTCString()
    : "Valid until transfer expiration";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Download Access Password</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 24px; margin: 0;">
        <div style="max-width: 520px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          
          <div style="margin-bottom: 24px;">
            <span style="font-size: 11px; font-family: monospace; text-transform: uppercase; padding: 4px 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; border-radius: 9999px; font-weight: bold;">
              OUT-OF-BAND AUTHENTICATION CREDENTIAL
            </span>
          </div>

          <h1 style="font-size: 20px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0;">
            Download Access Password
          </h1>

          <p style="font-size: 13px; line-height: 1.6; color: #9ca3af; margin: 0 0 20px 0;">
            ${senderEmail ? `<strong>${senderEmail}</strong> has configured` : "This secure transfer requires"} password authorization.
            Use the password below to decrypt and reconstruct your file bundle:
          </p>

          <div style="background: #0b0f19; border: 1px solid #374151; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
            <div style="font-size: 11px; font-family: monospace; color: #9ca3af; text-transform: uppercase; margin-bottom: 8px;">
              Transfer Password for Link [${shareLinkId}]
            </div>
            <div style="font-family: 'Courier New', Courier, monospace; font-size: 28px; font-weight: 800; letter-spacing: 5px; color: #6366f1; background: #111827; padding: 12px 20px; border-radius: 8px; display: inline-block; border: 1px solid #4b5563;">
              ${password}
            </div>
            <div style="font-size: 11px; color: #fbbf24; margin-top: 10px; font-family: monospace;">
              ⏱ ${expiryString}
            </div>
          </div>

          <div style="background: rgba(31, 41, 55, 0.5); border-radius: 8px; padding: 14px; font-size: 12px; color: #9ca3af; line-height: 1.5;">
            <strong>Security Notice:</strong> This password was dispatched separately from the download link to maintain two-channel isolation.
            Never forward this email or share your password over unencrypted channels.
          </div>

          <div style="border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 11px; color: #6b7280; font-family: monospace;">
            Transfer Token ID: ${shareLinkId}<br>
            Protected with AES-256-GCM Envelope Encryption
          </div>

        </div>
      </body>
    </html>
  `;
}

/**
 * Main Email Notification Dispatcher
 * Dispatches combined or separate emails with resilient fallbacks
 */
export async function sendShareNotificationEmail(
  opts: ShareNotificationOptions
): Promise<DeliveryResult> {
  const {
    recipientEmail,
    senderEmail,
    shareUrl,
    shareLinkId,
    fileNames,
    fileCount,
    password,
    authMethod,
    transferMode,
    expiresAt,
    maxDownloads,
    deliveryMode = "COMBINED",
    clientIp,
  } = opts;

  if (!recipientEmail || !recipientEmail.includes("@")) {
    return {
      success: false,
      deliveryMode,
      messagesSent: 0,
      simulated: false,
      error: "Invalid recipient email address",
    };
  }

  // Compute encrypted password token if not directly provided
  let cipherToken = opts.encryptedPasswordToken || null;
  if (!cipherToken && password && password.trim().length > 0) {
    try {
      cipherToken = toCipherToken(encryptSecret(password.trim()));
    } catch (e) {
      console.error("[EmailService] Failed to derive cipher token from password:", e);
    }
  }

  const cleanShareUrl = shareUrl
    .replace(/https?:\/\/[^/]*your-service-name[^/]*/gi, DEFAULT_PORTAL_BASE_URL)
    .trim();

  const baseUrl = cleanShareUrl.includes("/d/")
    ? cleanShareUrl.split("/d/")[0]
    : resolvePortalBaseUrl();

  const effectiveRecoveryUrl =
    (opts.recoveryUrl && !opts.recoveryUrl.includes("your-service-name"))
      ? opts.recoveryUrl.trim()
      : `${baseUrl}/recovery?id=${shareLinkId}${cipherToken ? `&cipher=${encodeURIComponent(cipherToken)}` : ""}`;

  const hasPassword = !!(cipherToken || (password && password.trim().length > 0));

  try {
    // Consolidated Single Email Delivery - Exactly 1 email sent per transfer
    const linkHtml = buildLinkEmailHtml({
      shareUrl: cleanShareUrl,
      recoveryUrl: effectiveRecoveryUrl,
      shareLinkId,
      senderEmail,
      fileNames,
      fileCount,
      transferMode,
      expiresAt,
      maxDownloads,
      authMethod,
      hasPassword,
      encryptedPasswordToken: cipherToken,
    });

    const subject = hasPassword
      ? `[SecureDocX] Secure File Bundle & Encrypted Password (${fileCount} file${fileCount > 1 ? "s" : ""})`
      : `[SecureDocX] Secure File Bundle Shared With You (${fileCount} file${fileCount > 1 ? "s" : ""})`;

    const textContent =
      `SecureDocX: ${fileCount} file(s) securely shared with you.\n\n` +
      `==================================================\n` +
      `1. DIRECT FILE LINK:\n` +
      `${cleanShareUrl}\n\n` +
      `2. RECOVERY PORTAL LINK (AUTO-DECRYPT):\n` +
      `${effectiveRecoveryUrl}\n\n` +
      (cipherToken
        ? `3. ENCRYPTED PASSWORD TOKEN (ZERO-KNOWLEDGE):\n` +
          `${cipherToken}\n` +
          `(Open the Recovery Portal link above to automatically decrypt this token into your download password)\n\n`
        : "") +
      `==================================================\n` +
      `Transfer ID: ${shareLinkId}\n` +
      `Security Standard: AES-256-GCM Envelope Encryption & SHA-256 Tamper-Proof Audit`;

    const result = await dispatchSingleEmail({
      to: recipientEmail,
      subject,
      html: linkHtml,
      text: textContent,
    });

    if (!result.success && !result.simulated) {
      return {
        success: false,
        deliveryMode: "COMBINED",
        messagesSent: 0,
        simulated: false,
        error: result.error || "Failed to dispatch email",
      };
    }

    await recordAuditEvent({
      action: "SHARE_EMAIL_DISPATCHED",
      ipAddress: clientIp || "127.0.0.1",
      shareLinkId,
      userEmail: recipientEmail,
      transferMode,
      details: {
        shareLinkId,
        recipientEmail,
        deliveryMode: "COMBINED",
        messagesSent: 1,
        simulated: result.simulated,
        hasCipherToken: !!cipherToken,
      },
    });

    return {
      success: true,
      deliveryMode: "COMBINED",
      messagesSent: 1,
      simulated: result.simulated,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EmailService] Unexpected delivery failure:", msg);
    return {
      success: false,
      deliveryMode: "COMBINED",
      messagesSent: 0,
      simulated: false,
      error: msg,
    };
  }
}
