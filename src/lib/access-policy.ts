import { db } from "./db";
import bcrypt from "bcryptjs";
import { evaluateRisk, RiskAssessment } from "./risk";

export interface AccessPolicyInput {
  linkId: string;
  clientIp: string;
  userAgent?: string | null;
  password?: string | null;
  otpCode?: string | null;
  sessionToken?: string | null;
  claimedEmail?: string | null;
  geoCountry?: string | null;
}

export interface PolicyEvaluationResult {
  granted: boolean;
  status: "GRANTED" | "DENIED" | "FROZEN" | "EXPIRED" | "REVOKED" | "PASSWORD_REQUIRED" | "OTP_REQUIRED" | "RECIPIENT_MISMATCH";
  reason: string;
  link?: any;
  riskAssessment: RiskAssessment;
}

/**
 * AccessPolicyEngine: Central policy verification gate.
 * Evaluates token validity, expiration, revocation, recipient binding, password, OTP, and dynamic risk.
 */
export async function evaluateAccessPolicy(
  input: AccessPolicyInput,
  isDownloadExecution: boolean = false
): Promise<PolicyEvaluationResult> {
  const { linkId, clientIp, password, otpCode, sessionToken, claimedEmail, geoCountry } = input;

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

  if (!link) {
    return {
      granted: false,
      status: "DENIED",
      reason: "Sharing link is invalid or does not exist.",
      riskAssessment: {
        score: 90,
        level: "HIGH",
        action: "BLOCK_AND_FREEZE",
        factors: ["Attempt to access non-existent token"],
        explanation: "Invalid token lookup",
      },
    };
  }

  // 1. Check Revocation and Freeze status
  if (link.isRevoked || link.status === "REVOKED") {
    return {
      granted: false,
      status: "REVOKED",
      reason: "Sharing link has been revoked by the document owner.",
      link,
      riskAssessment: { score: 10, level: "LOW", action: "ALLOW", factors: [], explanation: "Revoked link" },
    };
  }

  if (link.status === "FROZEN" || link.status === "BLOCKED") {
    return {
      granted: false,
      status: "FROZEN",
      reason: "This transfer has been frozen due to security policy violations or high risk alerts.",
      link,
      riskAssessment: { score: 85, level: "HIGH", action: "BLOCK_AND_FREEZE", factors: ["Frozen transfer accessed"], explanation: "Frozen access link" },
    };
  }

  // 2. Check Expiration
  if (link.expiresAt && new Date() > link.expiresAt) {
    // Automatically update status to EXPIRED
    await db.shareLink.update({
      where: { id: linkId },
      data: { status: "EXPIRED" },
    });

    return {
      granted: false,
      status: "EXPIRED",
      reason: "This transfer link has expired.",
      link,
      riskAssessment: { score: 10, level: "LOW", action: "ALLOW", factors: [], explanation: "Expired link" },
    };
  }

  // 3. Check Download Limit Pre-condition
  if (link.maxDownloads && link.downloadCount >= link.maxDownloads) {
    return {
      granted: false,
      status: "DENIED",
      reason: "Maximum download limit for this link has been reached.",
      link,
      riskAssessment: { score: 30, level: "LOW", action: "ALLOW", factors: ["Download limit reached"], explanation: "Limit reached" },
    };
  }

  // 4. Check IP Restrictions
  if (link.allowedIps) {
    const allowed = link.allowedIps.split(",").map((ip) => ip.trim());
    const match = allowed.some((allowedIp) => {
      if (allowedIp === clientIp) return true;
      if (allowedIp.includes("/")) {
        const baseIp = allowedIp.split("/")[0];
        return clientIp.startsWith(baseIp.substring(0, baseIp.lastIndexOf(".")));
      }
      return false;
    });

    if (!match) {
      return {
        granted: false,
        status: "DENIED",
        reason: "Access denied: IP restriction policy violation.",
        link,
        riskAssessment: { score: 95, level: "HIGH", action: "BLOCK_AND_FREEZE", factors: ["IP restriction policy mismatch"], explanation: "IP mismatch" },
      };
    }
  }

  // 5. Evaluate Risk Engine
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const failedAttemptsCount = await db.auditLog.count({
    where: {
      action: "LINK_ACCESS_FAIL",
      ipAddress: clientIp,
      timestamp: { gte: fiveMinAgo },
    },
  });

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentDownloadsInHour = await db.auditLog.count({
    where: {
      action: "DOWNLOAD",
      ipAddress: clientIp,
      timestamp: { gte: oneHourAgo },
    },
  });

  const riskAssessment = evaluateRisk({
    ipAddress: clientIp,
    recipientEmail: link.recipientEmail,
    claimedEmail,
    linkId,
    geoCountry,
    allowedGeos: link.allowedGeos,
    failedAttemptsCount,
    recentDownloadsInHour,
  });

  // If Risk is HIGH, freeze the share immediately
  if (riskAssessment.action === "BLOCK_AND_FREEZE") {
    await db.shareLink.update({
      where: { id: linkId },
      data: { status: "FROZEN" },
    });

    return {
      granted: false,
      status: "FROZEN",
      reason: `Access blocked: High risk detected (${riskAssessment.score}/100). Link has been temporarily frozen.`,
      link,
      riskAssessment,
    };
  }

  // Pre-validate OTP authorization session token (if supplied)
  let isSessionValid = false;
  let sessionRecipientEmail: string | null = null;

  if (sessionToken && sessionToken.length >= 32) {
    const validOtpSession = await db.emailOtp.findFirst({
      where: {
        shareLinkId: link.id,
        sessionToken,
        sessionExpiresAt: { gte: new Date() },
      },
    });

    if (validOtpSession) {
      isSessionValid = true;
      sessionRecipientEmail = validOtpSession.recipientEmail.toLowerCase().trim();
    }
  }

  // 6. Recipient Binding Verification
  if (link.recipientEmail) {
    const targetRecipient = link.recipientEmail.toLowerCase().trim();

    // If recipient has already verified identity through a valid OTP session token:
    if (isSessionValid && sessionRecipientEmail === targetRecipient) {
      // Identity successfully verified via OTP session!
    } else {
      const effectiveEmail = (claimedEmail || sessionRecipientEmail)?.toLowerCase().trim();
      if (!effectiveEmail) {
        const usesOtp = link.authMethod === "EMAIL_OTP" || link.authMethod === "BOTH" || link.otpEnabled;
        return {
          granted: false,
          status: usesOtp ? "OTP_REQUIRED" : "RECIPIENT_MISMATCH",
          reason: usesOtp
            ? "Email OTP verification required to authorize designated recipient."
            : "This document is bound to a specific recipient email. Identity verification required.",
          link,
          riskAssessment,
        };
      }
      if (effectiveEmail !== targetRecipient) {
        return {
          granted: false,
          status: "RECIPIENT_MISMATCH",
          reason: "Access denied: Your identity does not match the designated recipient for this secure transfer.",
          link,
          riskAssessment,
        };
      }
    }
  }

  // 7. Password Verification (if required)
  if (link.passwordHash) {
    if (!password) {
      return {
        granted: false,
        status: "PASSWORD_REQUIRED",
        reason: "Access password is required.",
        link,
        riskAssessment,
      };
    }
    const isPasswordValid = await bcrypt.compare(password, link.passwordHash);
    if (!isPasswordValid) {
      return {
        granted: false,
        status: "DENIED",
        reason: "Incorrect access password.",
        link,
        riskAssessment,
      };
    }
  }

  // 8. OTP Verification (if required or enforced by risk level)
  const requireOtp = link.otpEnabled || link.authMethod === "EMAIL_OTP" || link.authMethod === "BOTH" || riskAssessment.level === "MEDIUM";
  if (requireOtp) {
    if (!isSessionValid) {
      if (!otpCode) {
        return {
          granted: false,
          status: "OTP_REQUIRED",
          reason: "Email OTP verification is required to download this file.",
          link,
          riskAssessment,
        };
      }

      let isOtpValid = false;

      // Check against hashed EmailOtp database record
      const activeOtpRecord = await db.emailOtp.findFirst({
        where: {
          shareLinkId: link.id,
          isUsed: false,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (activeOtpRecord) {
        const { verifyOTPHash } = await import("./email-otp");
        isOtpValid = verifyOTPHash(otpCode.trim(), activeOtpRecord.otpHash);
        if (isOtpValid) {
          await db.emailOtp.update({
            where: { id: activeOtpRecord.id },
            data: { isUsed: true, verifiedAt: new Date() },
          });
        }
      } else if (link.otpSecret && otpCode.trim() === link.otpSecret.trim()) {
        isOtpValid = true;
      }

      if (!isOtpValid) {
        return {
          granted: false,
          status: "DENIED",
          reason: "Invalid or expired OTP verification passcode.",
          link,
          riskAssessment,
        };
      }
    }
  }

  // 9. If this is the actual download execution, perform atomic download increment
  if (isDownloadExecution) {
    try {
      await db.$transaction(async (tx) => {
        const freshLink = await tx.shareLink.findUnique({
          where: { id: linkId },
        });

        if (!freshLink || freshLink.isRevoked || freshLink.status !== "ACTIVE") {
          throw new Error("Transfer link is no longer active.");
        }

        if (freshLink.maxDownloads && freshLink.downloadCount >= freshLink.maxDownloads) {
          throw new Error("Maximum download limit reached.");
        }

        const newCount = freshLink.downloadCount + 1;
        const newStatus = freshLink.maxDownloads && newCount >= freshLink.maxDownloads ? "ACCESSED" : "ACTIVE";

        await tx.shareLink.update({
          where: { id: linkId },
          data: {
            downloadCount: newCount,
            status: newStatus,
          },
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Download limit exceeded or transaction failed";
      return {
        granted: false,
        status: "DENIED",
        reason: msg,
        link,
        riskAssessment,
      };
    }
  }

  return {
    granted: true,
    status: "GRANTED",
    reason: "Access policy criteria verified successfully.",
    link,
    riskAssessment,
  };
}
