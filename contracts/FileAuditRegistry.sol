// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FileAuditRegistry
 * @notice Decentralized cryptographic proof registry for SecureDocX (Secure Document Exchange Portal).
 * @dev Stores tamper-evident SHA-256 integrity hashes and canonical event proofs.
 *      Never stores actual document content, keys, passwords, or personal data on-chain.
 */
contract FileAuditRegistry {
    struct ProofRecord {
        bytes32 documentHash;     // SHA-256 integrity hash of encrypted file
        bytes32 eventHash;        // SHA-256 hash of canonical transfer event
        uint256 timestamp;        // Block timestamp when proof was committed
        string eventType;         // e.g. "DOCUMENT_REGISTERED", "SHARE_CREATED", "DOWNLOAD_COMPLETED", "HIGH_RISK_BLOCK"
        address recorder;         // Address that submitted the proof
        bool exists;              // Existence flag
    }

    // Mapping from canonical proofId to ProofRecord
    mapping(bytes32 => ProofRecord) private proofs;

    // Array of all registered proof IDs for enumeration
    bytes32[] private proofIds;

    // Contract owner / deployer
    address public owner;

    // Events emitted for off-chain indexing and audit verification
    event DocumentProofRegistered(
        bytes32 indexed proofId,
        bytes32 indexed documentHash,
        bytes32 eventHash,
        uint256 timestamp,
        string eventType,
        address indexed recorder
    );

    event TransferProofRecorded(
        bytes32 indexed proofId,
        bytes32 indexed transferProofHash,
        uint256 timestamp,
        string eventType,
        address indexed recorder
    );

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Registers an initial document integrity proof.
     * @param proofId Unique canonical proof identifier (bytes32).
     * @param documentHash SHA-256 hash of the encrypted payload.
     * @param eventHash SHA-256 hash of the canonical transfer policy record.
     * @param eventType Description of the event (e.g., "DOCUMENT_REGISTERED", "SHARE_CREATED").
     */
    function registerDocumentProof(
        bytes32 proofId,
        bytes32 documentHash,
        bytes32 eventHash,
        string calldata eventType
    ) external {
        require(proofId != bytes32(0), "Invalid proof ID");
        require(documentHash != bytes32(0), "Invalid document hash");
        require(!proofs[proofId].exists, "Proof already exists");

        proofs[proofId] = ProofRecord({
            documentHash: documentHash,
            eventHash: eventHash,
            timestamp: block.timestamp,
            eventType: eventType,
            recorder: msg.sender,
            exists: true
        });

        proofIds.push(proofId);

        emit DocumentProofRegistered(
            proofId,
            documentHash,
            eventHash,
            block.timestamp,
            eventType,
            msg.sender
        );
    }

    /**
     * @notice Records subsequent lifecycle proof events (e.g. DOWNLOAD_COMPLETED, HIGH_RISK_BLOCK, SHARE_REVOKED).
     * @param proofId Unique proof identifier for the event.
     * @param transferProofHash SHA-256 hash of the transfer execution parameters.
     * @param eventType Description of the transfer event.
     */
    function recordTransferProof(
        bytes32 proofId,
        bytes32 transferProofHash,
        string calldata eventType
    ) external {
        require(proofId != bytes32(0), "Invalid proof ID");
        require(transferProofHash != bytes32(0), "Invalid transfer proof hash");
        require(!proofs[proofId].exists, "Proof already exists");

        proofs[proofId] = ProofRecord({
            documentHash: transferProofHash,
            eventHash: transferProofHash,
            timestamp: block.timestamp,
            eventType: eventType,
            recorder: msg.sender,
            exists: true
        });

        proofIds.push(proofId);

        emit TransferProofRecorded(
            proofId,
            transferProofHash,
            block.timestamp,
            eventType,
            msg.sender
        );
    }

    /**
     * @notice Verifies an existing proof record on-chain.
     * @param proofId Canonical identifier to query.
     */
    function verifyProof(bytes32 proofId)
        external
        view
        returns (
            bytes32 documentHash,
            bytes32 eventHash,
            uint256 timestamp,
            string memory eventType,
            address recorder,
            bool exists
        )
    {
        ProofRecord memory p = proofs[proofId];
        return (
            p.documentHash,
            p.eventHash,
            p.timestamp,
            p.eventType,
            p.recorder,
            p.exists
        );
    }

    /**
     * @notice Returns the total count of proofs recorded in this registry.
     */
    function totalProofs() external view returns (uint256) {
        return proofIds.length;
    }

    /**
     * @notice Returns proofId by index.
     */
    function getProofIdByIndex(uint256 index) external view returns (bytes32) {
        require(index < proofIds.length, "Index out of bounds");
        return proofIds[index];
    }
}
