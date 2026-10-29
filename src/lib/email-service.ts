import nodemailer from "nodemailer";
import { recordAuditEvent } from "./audit";

export type EmailDeliveryMode = "COMBINED" | "SEPARATE" | "LINK_ONLY";

export interface ShareNotificationOptions {
  recipientEmail: string;
  senderEmail?: string;
  shareUrl: string;
  shareLinkId: string;
  fileNames: string[];
  fileCount: number;
  totalSizeFormatted?: string;
  password?: string | null;
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

  // Tier 1: Resend HTTP API (Port 443 HTTPS - Works on Render Free Tier)
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey && isConfigured(resendApiKey)) {
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
        if (allowSimulation) {
          return { success: true, simulated: true, error: `Resend: ${errDetail}` };
        }
        return { success: false, simulated: false, error: errDetail };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EmailService] Resend API request failed:", msg);
      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }

  // Tier 2: Brevo HTTP API (Port 443 HTTPS)
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
            email: process.env.SMTP_USER || "no-reply@securedocx.portal",
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
        if (allowSimulation) {
          return { success: true, simulated: true, error: `Brevo: ${errDetail}` };
        }
        return { success: false, simulated: false, error: errDetail };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }

  // Tier 3: Nodemailer (Gmail SMTP or Custom SMTP)
  const transporter = createEmailTransporter();
  if (transporter) {
    const fromAddress =
      process.env.SMTP_FROM ||
      `"SecureDocX Portal" <${process.env.SMTP_USER || "no-reply@securedocx.portal"}>`;

    try {
      await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text,
        html,
      });
      return { success: true, simulated: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EmailService] SMTP send error:", msg);
      if (allowSimulation) {
        return { success: true, simulated: true, error: msg };
      }
      return { success: false, simulated: false, error: msg };
    }
  }

  // Tier 4: Simulated Delivery
  console.log(`\n======================================================`);
  console.log(`[SECUREDOCX EMAIL DISPATCH SIMULATOR]`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`======================================================\n`);
  return { success: true, simulated: true };
}

/**
 * Builds the HTML template for Link / Transfer Notification
 */
function buildLinkEmailHtml({
  shareUrl,
  shareLinkId,
  senderEmail,
  fileNames,
  fileCount,
  transferMode,
  expiresAt,
  maxDownloads,
  authMethod,
  hasPassword,
  isSeparate,
  combinedPassword,
}: {
  shareUrl: string;
  shareLinkId: string;
  senderEmail?: string;
  fileNames: string[];
  fileCount: number;
  transferMode: string;
  expiresAt?: Date | string | null;
  maxDownloads?: number | null;
  authMethod: string;
  hasPassword: boolean;
  isSeparate: boolean;
  combinedPassword?: string | null;
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

  let passwordBanner = "";
  if (hasPassword) {
    if (isSeparate) {
      passwordBanner = `
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 16px; margin: 20px 0;">
          <div style="font-weight: 700; color: #fbbf24; font-size: 13px; margin-bottom: 4px;">🔐 Password Protection Active (Sent Separately)</div>
          <div style="font-size: 12px; color: #d1d5db; line-height: 1.5;">
            For enhanced security, the download password for this transfer is being sent to your email address in a <strong>separate message</strong>.
          </div>
        </div>
      `;
    } else if (combinedPassword) {
      passwordBanner = `
        <div style="background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 12px; padding: 16px; margin: 20px 0; text-align: center;">
          <div style="font-weight: 700; color: #a5b4fc; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Download Password</div>
          <div style="font-family: 'Courier New', Courier, monospace; font-size: 22px; font-weight: 800; letter-spacing: 4px; color: #ffffff; background: #0b0f19; padding: 10px 16px; border-radius: 8px; display: inline-block; border: 1px solid #374151;">
            ${combinedPassword}
          </div>
          <div style="font-size: 11px; color: #9ca3af; margin-top: 8px;">Keep this password confidential. Do not forward this email.</div>
        </div>
      `;
    }
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Secure Files Shared With You</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; padding: 24px; margin: 0;">
        <div style="max-width: 560px; margin: 0 auto; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          
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

          ${passwordBanner}

          <div style="text-align: center; margin: 28px 0;">
            <a href="${shareUrl}" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
              Access Secure Files &rarr;
            </a>
          </div>

          <div style="background: #0b0f19; border: 1px solid #1f2937; border-radius: 10px; padding: 14px; margin-top: 24px; font-size: 12px; color: #9ca3af; line-height: 1.6;">
            <div><strong>Transfer ID:</strong> <span style="font-family: monospace; color: #e5e7eb;">${shareLinkId}</span></div>
            <div><strong>Authentication Policy:</strong> <span style="font-family: monospace; color: #e5e7eb;">${authMethod}</span></div>
            <div><strong>Expires At:</strong> <span style="font-family: monospace; color: #e5e7eb;">${expiryString}</span></div>
            ${maxDownloads ? `<div><strong>Download Quota:</strong> <span style="font-family: monospace; color: #e5e7eb;">${maxDownloads} download(s) allowed</span></div>` : ""}
          </div>

          <div style="border-top: 1px solid #1f2937; padding-top: 20px; margin-top: 24px; font-size: 11px; color: #6b7280; font-family: monospace; line-height: 1.5;">
            Direct URL: <a href="${shareUrl}" style="color: #818cf8; word-break: break-all;">${shareUrl}</a><br><br>
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
    deliveryMode = "SEPARATE",
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

  const hasPassword = !!(password && password.trim().length > 0);
  const actualDeliveryMode: EmailDeliveryMode =
    !hasPassword ? "LINK_ONLY" : deliveryMode;

  try {
    if (actualDeliveryMode === "SEPARATE") {
      // 1. Send Link Notification (mentions password follows in separate email)
      const linkHtml = buildLinkEmailHtml({
        shareUrl,
        shareLinkId,
        senderEmail,
        fileNames,
        fileCount,
        transferMode,
        expiresAt,
        maxDownloads,
        authMethod,
        hasPassword: true,
        isSeparate: true,
      });

      const linkResult = await dispatchSingleEmail({
        to: recipientEmail,
        subject: `[SecureDocX] Secure File Bundle Shared With You (${fileCount} file${fileCount > 1 ? "s" : ""})`,
        html: linkHtml,
        text: `SecureDocX: ${fileCount} file(s) shared with you. Access link: ${shareUrl}. Password is being sent in a separate email.`,
      });

      if (!linkResult.success && !linkResult.simulated) {
        return {
          success: false,
          deliveryMode: "SEPARATE",
          messagesSent: 0,
          simulated: false,
          error: linkResult.error || "Failed to send download link email",
        };
      }

      // 2. Send Password Notification (Separate email)
      const passwordHtml = buildPasswordEmailHtml({
        password: password!,
        shareLinkId,
        senderEmail,
        expiresAt,
      });

      const passResult = await dispatchSingleEmail({
        to: recipientEmail,
        subject: `[SecureDocX] Access Password for Transfer [${shareLinkId}]`,
        html: passwordHtml,
        text: `Your download access password for SecureDocX transfer [${shareLinkId}] is: ${password}`,
      });

      const simulated = linkResult.simulated || passResult.simulated;

      // Audit log the email dispatch
      await recordAuditEvent({
        action: "SHARE_EMAIL_DISPATCHED",
        ipAddress: clientIp || "127.0.0.1",
        shareLinkId,
        userEmail: recipientEmail,
        transferMode,
        details: {
          shareLinkId,
          recipientEmail,
          deliveryMode: "SEPARATE",
          messagesSent: 2,
          simulated,
        },
      });

      return {
        success: true,
        deliveryMode: "SEPARATE",
        messagesSent: 2,
        simulated,
      };
    } else {
      // COMBINED or LINK_ONLY: Send single email
      const combinedHtml = buildLinkEmailHtml({
        shareUrl,
        shareLinkId,
        senderEmail,
        fileNames,
        fileCount,
        transferMode,
        expiresAt,
        maxDownloads,
        authMethod,
        hasPassword,
        isSeparate: false,
        combinedPassword: password,
      });

      const subject = hasPassword
        ? `[SecureDocX] Secure File Bundle & Password Enclosed (${fileCount} file${fileCount > 1 ? "s" : ""})`
        : `[SecureDocX] Secure File Bundle Shared With You (${fileCount} file${fileCount > 1 ? "s" : ""})`;

      const result = await dispatchSingleEmail({
        to: recipientEmail,
        subject,
        html: combinedHtml,
        text: `SecureDocX: ${fileCount} file(s) shared with you. Access link: ${shareUrl}${password ? ` | Password: ${password}` : ""}`,
      });

      if (!result.success && !result.simulated) {
        return {
          success: false,
          deliveryMode: actualDeliveryMode,
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
          deliveryMode: actualDeliveryMode,
          messagesSent: 1,
          simulated: result.simulated,
        },
      });

      return {
        success: true,
        deliveryMode: actualDeliveryMode,
        messagesSent: 1,
        simulated: result.simulated,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[EmailService] Unexpected delivery failure:", msg);
    return {
      success: false,
      deliveryMode: actualDeliveryMode,
      messagesSent: 0,
      simulated: false,
      error: msg,
    };
  }
}
