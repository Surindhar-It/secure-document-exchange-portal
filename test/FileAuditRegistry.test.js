const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FileAuditRegistry Smart Contract", function () {
  let registry;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const FileAuditRegistry = await ethers.getContractFactory("FileAuditRegistry");
    registry = await FileAuditRegistry.deploy();
    await registry.waitForDeployment();
  });

  it("should deploy with deployer as owner", async function () {
    expect(await registry.owner()).to.equal(owner.address);
    expect(await registry.totalProofs()).to.equal(0);
  });

  it("should register a document integrity proof successfully", async function () {
    const proofId = ethers.keccak256(ethers.toUtf8Bytes("proof_test_001"));
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("document_ciphertext_hash_sha256"));
    const eventHash = ethers.keccak256(ethers.toUtf8Bytes("canonical_event_hash"));
    const eventType = "DOCUMENT_REGISTERED";

    await expect(registry.connect(user).registerDocumentProof(proofId, docHash, eventHash, eventType))
      .to.emit(registry, "DocumentProofRegistered");

    expect(await registry.totalProofs()).to.equal(1);

    const proof = await registry.verifyProof(proofId);
    expect(proof.exists).to.be.true;
    expect(proof.documentHash).to.equal(docHash);
    expect(proof.eventHash).to.equal(eventHash);
    expect(proof.eventType).to.equal(eventType);
    expect(proof.recorder).to.equal(user.address);
  });

  it("should reject registering duplicate proof ID", async function () {
    const proofId = ethers.keccak256(ethers.toUtf8Bytes("proof_duplicate"));
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("hash1"));
    const eventHash = ethers.keccak256(ethers.toUtf8Bytes("event1"));

    await registry.registerDocumentProof(proofId, docHash, eventHash, "SHARE_CREATED");

    await expect(
      registry.registerDocumentProof(proofId, docHash, eventHash, "SHARE_CREATED")
    ).to.be.revertedWith("Proof already exists");
  });

  it("should record a transfer proof event", async function () {
    const proofId = ethers.keccak256(ethers.toUtf8Bytes("proof_transfer_001"));
    const transferHash = ethers.keccak256(ethers.toUtf8Bytes("download_executed"));

    await expect(registry.recordTransferProof(proofId, transferHash, "DOWNLOAD_COMPLETED"))
      .to.emit(registry, "TransferProofRecorded");

    const proof = await registry.verifyProof(proofId);
    expect(proof.exists).to.be.true;
    expect(proof.eventType).to.equal("DOWNLOAD_COMPLETED");
  });
});
