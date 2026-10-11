import { ethers } from "ethers";
import fs from "fs";
import path from "path";

// ABI for FileAuditRegistry
const CONTRACT_ABI = [
  "function registerDocumentProof(bytes32 proofId, bytes32 documentHash, bytes32 eventHash, string calldata eventType) external",
  "function recordTransferProof(bytes32 proofId, bytes32 transferProofHash, string calldata eventType) external",
  "function verifyProof(bytes32 proofId) external view returns (bytes32 documentHash, bytes32 eventHash, uint256 timestamp, string memory eventType, address recorder, bool exists)",
  "function totalProofs() external view returns (uint256)",
  "function owner() external view returns (address)",
  "event DocumentProofRegistered(bytes32 indexed proofId, bytes32 indexed documentHash, bytes32 eventHash, uint256 timestamp, string eventType, address indexed recorder)",
  "event TransferProofRecorded(bytes32 indexed proofId, bytes32 indexed transferProofHash, uint256 timestamp, string eventType, address indexed recorder)"
];

// Helper to load deployed contract address
function getContractAddress(): string {
  if (process.env.SMART_CONTRACT_ADDRESS) {
    return process.env.SMART_CONTRACT_ADDRESS;
  }
  try {
    const deploymentPath = path.join(process.cwd(), "src/lib/contract-deployment.json");
    if (fs.existsSync(deploymentPath)) {
      const data = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
      return data.contractAddress || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    }
  } catch {
    // fallback
  }
  return "0x5FbDB2315678afecb367f032d93F642f64180aa3";
}

// Convert string/hash to bytes32 format for Solidity
export function toBytes32(str: string): string {
  if (!str) return ethers.ZeroHash;
  // If already a valid 32-byte hex string (66 chars including 0x)
  if (str.startsWith("0x") && str.length === 66) {
    return str;
  }
  if (!str.startsWith("0x") && str.length === 64) {
    return "0x" + str;
  }
  // Otherwise hash it to guarantee bytes32
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

// Get provider and signer
async function getBlockchainContext(): Promise<{
  provider: ethers.JsonRpcProvider;
  signer: ethers.Signer | null;
  contractAddress: string;
  network: string;
} | null> {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
  const network = process.env.BLOCKCHAIN_NETWORK || "sepolia";
  const contractAddress = getContractAddress();

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    // Quick probe to check if node responds within 1.5 seconds
    await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RPC Timeout")), 1500)),
    ]);

    let signer: ethers.Signer | null = null;
    if (process.env.BLOCKCHAIN_PRIVATE_KEY) {
      signer = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);
    } else {
      // Try local hardhat node account #0
      try {
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
          signer = accounts[0];
        }
      } catch {
        signer = null;
      }
    }

    return { provider, signer, contractAddress, network };
  } catch (err) {
    // Node is offline or unreachable
    return null;
  }
}

export interface ProofSubmissionResult {
  status: "CONFIRMED" | "PENDING" | "FAILED";
  txHash?: string | null;
  blockNumber?: number | null;
  contractAddress?: string;
  network?: string;
  error?: string;
}

/**
 * Register a document integrity proof on the blockchain.
 */
export async function registerDocumentProofOnChain(
  proofId: string,
  documentHash: string,
  eventHash: string,
  eventType: string = "DOCUMENT_REGISTERED"
): Promise<ProofSubmissionResult> {
  const context = await getBlockchainContext();
  const contractAddress = getContractAddress();
  const network = process.env.BLOCKCHAIN_NETWORK || "sepolia";

  if (!context || !context.signer) {
    return {
      status: "PENDING",
      contractAddress,
      network,
      error: "Blockchain RPC not connected or wallet signer not configured. Proof queued in tamper-evident database.",
    };
  }

  try {
    const contract = new ethers.Contract(context.contractAddress, CONTRACT_ABI, context.signer);
    const proofIdBytes = toBytes32(proofId);
    const docHashBytes = toBytes32(documentHash);
    const eventHashBytes = toBytes32(eventHash);

    const tx = await contract.registerDocumentProof(
      proofIdBytes,
      docHashBytes,
      eventHashBytes,
      eventType
    );

    const receipt = await tx.wait(1);

    return {
      status: "CONFIRMED",
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      contractAddress: context.contractAddress,
      network: context.network,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "FAILED",
      contractAddress,
      network,
      error: msg,
    };
  }
}

/**
 * Record a subsequent transfer event proof on the blockchain.
 */
export async function recordTransferProofOnChain(
  proofId: string,
  transferProofHash: string,
  eventType: string
): Promise<ProofSubmissionResult> {
  const context = await getBlockchainContext();
  const contractAddress = getContractAddress();
  const network = process.env.BLOCKCHAIN_NETWORK || "sepolia";

  if (!context || !context.signer) {
    return {
      status: "PENDING",
      contractAddress,
      network,
      error: "Blockchain RPC offline. Event queued in database audit registry.",
    };
  }

  try {
    const contract = new ethers.Contract(context.contractAddress, CONTRACT_ABI, context.signer);
    const proofIdBytes = toBytes32(proofId);
    const proofHashBytes = toBytes32(transferProofHash);

    const tx = await contract.recordTransferProof(proofIdBytes, proofHashBytes, eventType);
    const receipt = await tx.wait(1);

    return {
      status: "CONFIRMED",
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      contractAddress: context.contractAddress,
      network: context.network,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: "FAILED",
      contractAddress,
      network,
      error: msg,
    };
  }
}

export interface VerificationResult {
  verified: boolean;
  status: "VERIFIED" | "INTEGRITY_MISMATCH" | "PENDING" | "NOT_FOUND" | "RPC_OFFLINE";
  onChainDocHash: string | null;
  dbDocHash: string;
  eventType: string | null;
  timestamp: string | null;
  recorder: string | null;
  contractAddress: string;
  network: string;
  txHash?: string | null;
  blockNumber?: number | null;
  message: string;
}

/**
 * Verify proof on-chain against database document hash.
 */
export async function verifyProofOnChain(
  proofId: string,
  expectedDocHash: string
): Promise<VerificationResult> {
  const contractAddress = getContractAddress();
  const network = process.env.BLOCKCHAIN_NETWORK || "sepolia";
  const context = await getBlockchainContext();

  if (!context) {
    return {
      verified: false,
      status: "RPC_OFFLINE",
      onChainDocHash: null,
      dbDocHash: expectedDocHash,
      eventType: null,
      timestamp: null,
      recorder: null,
      contractAddress,
      network,
      message: "Ethereum RPC node is currently unreachable. Blockchain proof verification is in standby.",
    };
  }

  try {
    const contract = new ethers.Contract(context.contractAddress, CONTRACT_ABI, context.provider);
    const proofIdBytes = toBytes32(proofId);
    const proof = await contract.verifyProof(proofIdBytes);

    if (!proof.exists) {
      return {
        verified: false,
        status: "NOT_FOUND",
        onChainDocHash: null,
        dbDocHash: expectedDocHash,
        eventType: null,
        timestamp: null,
        recorder: null,
        contractAddress: context.contractAddress,
        network: context.network,
        message: "No on-chain proof record found for this identifier.",
      };
    }

    const onChainHash = proof.documentHash.toLowerCase();
    const expectedHashBytes = toBytes32(expectedDocHash).toLowerCase();

    const isMatch = onChainHash === expectedHashBytes;

    return {
      verified: isMatch,
      status: isMatch ? "VERIFIED" : "INTEGRITY_MISMATCH",
      onChainDocHash: proof.documentHash,
      dbDocHash: expectedDocHash,
      eventType: proof.eventType,
      timestamp: new Date(Number(proof.timestamp) * 1000).toISOString(),
      recorder: proof.recorder,
      contractAddress: context.contractAddress,
      network: context.network,
      message: isMatch
        ? "Document integrity verified against Ethereum smart contract registry."
        : "Warning: Cryptographic hash mismatch between database record and blockchain ledger!",
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      verified: false,
      status: "RPC_OFFLINE",
      onChainDocHash: null,
      dbDocHash: expectedDocHash,
      eventType: null,
      timestamp: null,
      recorder: null,
      contractAddress,
      network,
      message: `Failed to query smart contract: ${msg}`,
    };
  }
}

/**
 * Get overall blockchain service health and total proof stats.
 */
export async function getBlockchainHealth(): Promise<{
  online: boolean;
  network: string;
  contractAddress: string;
  totalOnChainProofs: number;
}> {
  const contractAddress = getContractAddress();
  const network = process.env.BLOCKCHAIN_NETWORK || "sepolia";
  const context = await getBlockchainContext();

  if (!context) {
    return {
      online: false,
      network,
      contractAddress,
      totalOnChainProofs: 0,
    };
  }

  try {
    const contract = new ethers.Contract(context.contractAddress, CONTRACT_ABI, context.provider);
    const count = await contract.totalProofs();
    return {
      online: true,
      network: context.network,
      contractAddress: context.contractAddress,
      totalOnChainProofs: Number(count),
    };
  } catch {
    return {
      online: false,
      network,
      contractAddress,
      totalOnChainProofs: 0,
    };
  }
}
