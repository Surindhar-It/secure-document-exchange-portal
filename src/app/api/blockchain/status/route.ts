import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBlockchainHealth } from "@/lib/blockchain";

export async function GET() {
  try {
    const health = await getBlockchainHealth();

    const [totalDbProofs, confirmedProofs, pendingProofs, failedProofs] = await Promise.all([
      db.blockchainProof.count(),
      db.blockchainProof.count({ where: { status: "CONFIRMED" } }),
      db.blockchainProof.count({ where: { status: "PENDING" } }),
      db.blockchainProof.count({ where: { status: "FAILED" } }),
    ]);

    const recentProofs = await db.blockchainProof.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      online: health.online,
      network: health.network,
      contractAddress: health.contractAddress,
      totalOnChainProofs: health.totalOnChainProofs,
      databaseStats: {
        total: totalDbProofs,
        confirmed: confirmedProofs,
        pending: pendingProofs,
        failed: failedProofs,
      },
      recentProofs,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to query blockchain status", details: msg },
      { status: 500 }
    );
  }
}
