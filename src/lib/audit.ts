import { db } from "./db";
import crypto from "crypto";
import {
  registerDocumentProofOnChain,
  recordTransferProofOnChain,
} from "./blockchain";

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export interface AuditLogInput {
  action: string;
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
  transferMode?: "STANDARD" | "BLOCKCHAIN";
  shareLinkId?: string | null;
  fileId?: string | null;
  documentHash?: string | null;
}

// 1. Calculate SHA-256 Hash of a Block
function calculateBlockHash(
  index: number,
  timestamp: Date,
  action: string,
  detailsStr: string,
  previousHash: string
): string {
  const content = `${index}|${timestamp.getTime()}|${action}|${detailsStr}|${previousHash}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sanitizeAuditDetails(details: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!details) return null;
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = ["password", "key", "otp", "secret", "dek", "privatekey", "token", "seed"];

  for (const [k, v] of Object.entries(details)) {
    const lowerKey = k.toLowerCase();
    if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
      sanitized[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      sanitized[k] = sanitizeAuditDetails(v as Record<string, unknown>);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

// 2. Core Database Audit Log Writer
export async function writeAuditLog({
  action,
  userId = null,
  userEmail = null,
  ipAddress = null,
  userAgent = null,
  details = null,
}: AuditLogInput) {
  try {
    const sanitized = sanitizeAuditDetails(details);
    const detailsStr = sanitized ? JSON.stringify(sanitized) : "";

    return await db.$transaction(async (tx) => {
      const lastBlock = await tx.auditLog.findFirst({
        orderBy: { index: "desc" },
      });

      let nextIndex = 0;
      let prevHash = GENESIS_HASH;

      if (lastBlock) {
        nextIndex = lastBlock.index + 1;
        prevHash = lastBlock.hash;
      }

      const timestamp = new Date();
      const hash = calculateBlockHash(nextIndex, timestamp, action, detailsStr, prevHash);

      const block = await tx.auditLog.create({
        data: {
          index: nextIndex,
          timestamp,
          action,
          userId,
          userEmail,
          ipAddress,
          userAgent,
          details: detailsStr,
          previousHash: prevHash,
          hash,
        },
      });

      return block;
    });
  } catch (error) {
    console.error("Failed to write database audit log:", error);
    return null;
  }
}

// 3. Verify Integrity of the Audit Log Hash Chain
export async function verifyAuditChain(): Promise<{
  isValid: boolean;
  tamperedIndex: number | null;
  totalBlocks: number;
}> {
  try {
    const logs = await db.auditLog.findMany({
      orderBy: { index: "asc" },
    });

    if (logs.length === 0) {
      return { isValid: true, tamperedIndex: null, totalBlocks: 0 };
    }

    let expectedPrevHash = GENESIS_HASH;

    for (let i = 0; i < logs.length; i++) {
      const block = logs[i];

      if (block.index !== i) {
        return { isValid: false, tamperedIndex: i, totalBlocks: logs.length };
      }

      if (block.previousHash !== expectedPrevHash) {
        return { isValid: false, tamperedIndex: i, totalBlocks: logs.length };
      }

      const calculatedHash = calculateBlockHash(
        block.index,
        block.timestamp,
        block.action,
        block.details || "",
        block.previousHash
      );

      if (block.hash !== calculatedHash) {
        return { isValid: false, tamperedIndex: i, totalBlocks: logs.length };
      }

      expectedPrevHash = block.hash;
    }

    return { isValid: true, tamperedIndex: null, totalBlocks: logs.length };
  } catch (error) {
    console.error("Failed to verify audit chain:", error);
    return { isValid: false, tamperedIndex: -1, totalBlocks: 0 };
  }
}

// 4. AuditService Abstraction (Section 27 of Master Specification)
export class DatabaseAuditService {
  async record(event: AuditLogInput) {
    return await writeAuditLog(event);
  }
}

export class BlockchainAuditService {
  async record(event: AuditLogInput) {
    // 1. Write to database audit chain first
    const dbBlock = await writeAuditLog(event);

    // 2. If transferMode is BLOCKCHAIN and relevant event, generate on-chain proof
    const isBlockchainEvent =
      event.transferMode === "BLOCKCHAIN" ||
      ["DOCUMENT_REGISTERED", "SHARE_CREATED", "DOWNLOAD_COMPLETED", "HIGH_RISK_BLOCK", "SHARE_REVOKED"].includes(event.action);

    if (isBlockchainEvent && event.documentHash) {
      const proofId = `proof_${crypto.randomBytes(12).toString("hex")}`;
      const canonicalData = JSON.stringify({
        action: event.action,
        shareLinkId: event.shareLinkId,
        fileId: event.fileId,
        timestamp: Date.now(),
        dbBlockHash: dbBlock?.hash || "",
      });

      const eventHash = crypto.createHash("sha256").update(canonicalData).digest("hex");

      // Create initial pending BlockchainProof in Prisma
      let proofRecord: any = null;
      try {
        proofRecord = await db.blockchainProof.create({
          data: {
            proofId,
            shareLinkId: event.shareLinkId || null,
            fileId: event.fileId || null,
            documentHash: event.documentHash,
            eventHash,
            eventType: event.action,
            status: "PENDING",
            network: process.env.BLOCKCHAIN_NETWORK || "sepolia",
          },
        });
      } catch (err) {
        console.error("Failed to insert BlockchainProof database record:", err);
      }

      // Submit proof on-chain asynchronously
      (async () => {
        try {
          let submissionResult;
          if (event.action === "DOCUMENT_REGISTERED" || event.action === "SHARE_CREATED") {
            submissionResult = await registerDocumentProofOnChain(
              proofId,
              event.documentHash!,
              eventHash,
              event.action
            );
          } else {
            submissionResult = await recordTransferProofOnChain(
              proofId,
              eventHash,
              event.action
            );
          }

          if (proofRecord) {
            await db.blockchainProof.update({
              where: { id: proofRecord.id },
              data: {
                status: submissionResult.status,
                txHash: submissionResult.txHash,
                blockNumber: submissionResult.blockNumber,
                contractAddress: submissionResult.contractAddress,
                network: submissionResult.network,
                errorMessage: submissionResult.error,
              },
            });
          }
        } catch (chainErr) {
          console.error("On-chain proof recording exception:", chainErr);
        }
      })();
    }

    return dbBlock;
  }
}

// Unified AuditService
export const databaseAuditService = new DatabaseAuditService();
export const blockchainAuditService = new BlockchainAuditService();

export async function recordAuditEvent(event: AuditLogInput) {
  if (event.transferMode === "BLOCKCHAIN") {
    return await blockchainAuditService.record(event);
  }
  return await databaseAuditService.record(event);
}
