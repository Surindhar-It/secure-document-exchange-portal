const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying FileAuditRegistry smart contract...");
  const FileAuditRegistry = await hre.ethers.getContractFactory("FileAuditRegistry");
  const registry = await FileAuditRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log(`FileAuditRegistry deployed successfully at: ${address}`);

  // Write deployment info for backend consumption
  const deployData = {
    contractAddress: address,
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "../src/lib/contract-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployData, null, 2));
  console.log(`Deployment metadata written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
