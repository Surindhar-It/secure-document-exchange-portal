import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyProofOnChain } from "@/lib/blockchain";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const proofId = searchParams.get("proofId");
  const linkId = searchParams.get("linkId");

  if (!proofId && !linkId) {
    return NextResponse.json(
      { error: "Either proofId or linkId is required for blockchain verification." },
      { status: 400 }
    );
  }

  try {
    let proof = null;
    if (proofId) {
      proof = await db.blockchainProof.findUnique({
        where: { proofId },
        include: { shareLink: true, file: true },
      });
    } else if (linkId) {
      proof = await db.blockchainProof.findFirst({
        where: { shareLinkId: linkId },
        include: { shareLink: true, file: true },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!proof) {
      return NextResponse.json(
        {
          verified: false,
          status: "NOT_FOUND",
          message: "No blockchain proof record found for this identifier in the local registry.",
        },
        { status: 404 }
      );
    }

    // Query on-chain smart contract for independent cryptographic verification
    const onChainResult = await verifyProofOnChain(proof.proofId, proof.documentHash);

    // If on-chain verification succeeded and proof was pending, update DB
    if (onChainResult.verified && proof.status !== "CONFIRMED" && proof.status !== "VERIFIED") {
      await db.blockchainProof.update({
        where: { id: proof.id },
        data: { status: "CONFIRMED" },
      });
    }

    return NextResponse.json({
      success: true,
      proofId: proof.proofId,
      shareLinkId: proof.shareLinkId,
      fileId: proof.fileId,
      eventType: proof.eventType,
      databaseDocumentHash: proof.documentHash,
      blockchainDocumentHash: onChainResult.onChainDocHash,
      verified: onChainResult.verified,
      status: onChainResult.status,
      network: onChainResult.network,
      contractAddress: onChainResult.contractAddress,
      txHash: proof.txHash,
      blockNumber: proof.blockNumber,
      timestamp: proof.timestamp,
      message: onChainResult.message,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Blockchain verification error:", error);
    return NextResponse.json(
      { error: "Failed to execute blockchain verification query", details: msg },
      { status: 500 }
    );
  }
}
