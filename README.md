# SecureDocX: Secure Document Exchange Portal

> **Secure. Share. Verify.**

**Secure Document Exchange Portal** is a zero-trust enterprise document-sharing platform designed for secure and controlled document transfer. It combines client-side AES-256-GCM encryption with policy-driven ephemeral links, recipient verification, multi-factor authentication (TOTP/WebAuthn), device controls, risk-based access decisions, atomic download restrictions, and automatic revocation.

Users can choose **Standard Transfer** for lightweight secure sharing or **Blockchain Transfer** for additional cryptographic integrity and tamper-evident audit verification. The documents themselves remain encrypted and stored off-chain, while blockchain records only minimal cryptographic proofs.

---

## 🌟 Core Novelty

### 1. Dual-Mode Secure Transfer Architecture

| Feature | Standard Transfer | Blockchain Transfer |
| :--- | :---: | :---: |
| **Client-Side Encryption (AES-256-GCM)** | ✅ | ✅ |
| **Off-Chain Secure Storage** | ✅ | ✅ |
| **Zero-Knowledge Ephemeral Link** | ✅ | ✅ |
| **Recipient Email Binding** | ✅ | ✅ |
| **Dynamic Access Policy Engine** | ✅ | ✅ |
| **MFA & Passkeys (WebAuthn)** | ✅ | ✅ |
| **Rule-Based Risk Engine** | ✅ | ✅ |
| **Tamper-Evident Database Audit Chain** | ✅ | ✅ |
| **SHA-256 Document Integrity Hash** | ❌ (Internal) | ✅ (Published On-Chain) |
| **Smart Contract Audit Registry** | ❌ | ✅ (`FileAuditRegistry.sol`) |
| **Independent On-Chain Verification** | ❌ | ✅ (Live Ethereum Verification) |

### 2. Policy-Driven Ephemeral Access
A sharing link is not merely a static URL — it encapsulates a dynamic security policy evaluated upon every access request:
```text
Access Decision = Token Valid
                ∧ Status Active (Not Frozen / Revoked)
                ∧ Not Expired
                ∧ Download Count < Limit (Atomic Transaction)
                ∧ Recipient Matches (if Bound)
                ∧ Password Valid (if Set)
                ∧ OTP Verified (if Enforced)
                ∧ Risk Score < 61 (LOW / MEDIUM)
```

If risk evaluation exceeds the threshold (Score 61–100), the transfer is automatically **FROZEN**, downloads are **BLOCKED**, an audit incident is logged, and for Blockchain Transfers, an on-chain `HIGH_RISK_BLOCK` proof is committed.

---

## 🏗️ Architecture

```text
                               USER / CLIENT
                                     │
                                     ▼
                              AUTHENTICATION
                         (Password + TOTP MFA / Passkey)
                                     │
                                     ▼
                              DOCUMENT UPLOAD
                        (Client-side AES-256-GCM)
                                     │
                                     ▼
                            ENCRYPTED STORAGE
                         (Off-chain server storage)
                                     │
                                     ▼
                           CREATE SECURE TRANSFER
                     ┌───────────────┴───────────────┐
                     │                               │
                     ▼                               ▼
              STANDARD TRANSFER             BLOCKCHAIN TRANSFER
                     │                               │
                     │                         SHA-256 HASH
                     │                               │
                     └───────────────┬───────────────┘
                                     │
                                     ▼
                              EPHEMERAL LINK
                               (/d/[id]#key)
                                     │
                                     ▼
                           RECIPIENT VERIFICATION
                        (Email Binding + Identity Check)
                                     │
                                     ▼
                          ACCESS POLICY ENGINE
                (Token, Expiry, Atomic Limits, Password, OTP)
                                     │
                                     ▼
                                RISK ENGINE
                   (Device, Anomaly, Rapid Downloads, Geolocation)
                                     │
                            ┌────────┴────────┐
                            ▼                 ▼
                          ALLOW             BLOCK
                     (Stream Cipher)    (Freeze Link)
                            │                 │
                            ▼                 ▼
                        AUDIT LOG        SECURITY ALERT
                            │                 │
                     ┌──────┴───────┐         │
                     │              │         │
                 STANDARD      BLOCKCHAIN     ▼
                     │              │    HIGH-RISK PROOF
                     ▼              ▼    (On-chain Alert)
                 DATABASE      PROOF HASH
                                    │
                                    ▼
                              SMART CONTRACT
                           (FileAuditRegistry)
                                    │
                                    ▼
                         INDEPENDENT VERIFICATION
```

---

## ⛓️ Smart Contract: `FileAuditRegistry`

Located in `contracts/FileAuditRegistry.sol`, the registry records cryptographic proofs without storing sensitive content, passwords, keys, or personal identifiers:

- `registerDocumentProof(bytes32 proofId, bytes32 documentHash, bytes32 eventHash, string eventType)`: Registers initial document integrity commitments.
- `recordTransferProof(bytes32 proofId, bytes32 transferProofHash, string eventType)`: Records lifecycle transfer events (`DOWNLOAD_COMPLETED`, `HIGH_RISK_BLOCK`, `SHARE_REVOKED`).
- `verifyProof(bytes32 proofId)`: View function returning on-chain document hash, timestamp, event type, and recorder address.

---

## 🔐 Advanced Enhancements

### 1. Hybrid Cryptography & KMS Key Envelope
- **AES-256-GCM Envelope Encryption**: Documents are encrypted with random 256-bit Data Encryption Keys (DEKs) and unique 12-byte IVs.
- **KMS Protection at Rest**: The raw DEK is never stored in the database, logs, URLs, or on-chain. It is wrapped using the server Key Management Service (`src/lib/kms.ts`) under a 256-bit Key Encryption Key (KEK) using HKDF.
- **Controlled Authorized Recovery**: Only upon successful authentication and policy evaluation does the backend release the unwrapped DEK to authorized recipients via secure response headers.
- **Strict Integrity Verification**: The original document's SHA-256 hash is computed before encryption and verified against the recovered plaintext before presentation.

### 2. Optional Image Steganography Carrier
- **Least Significant Bit (LSB) Encoding**: Embeds and extracts verification tokens or encrypted key packages inside lossless PNG or BMP carriers (`src/lib/steganography.ts`).
- **Cryptographic Packet Structure**: 4-byte `STGX` magic marker + 4-byte big-endian length + payload bitstream + 4-byte Adler/CRC checksum.
- **Carrier Independence**: Steganography acts strictly as an optional transport carrier. Possession of the image alone never grants document access; recipient authorization and backend policy checks are always required.

### 3. Dedicated Document Recovery Portal (`/recovery`)
- **Document Lookup**: Locate transfers by share ID or URL.
- **Policy Barriers**: Recipient email binding, password gates, and simulated OTP MFA.
- **Optional Stego Carrier Dropzone**: Automatically extracts embedded payloads and validates checksums.
- **Live Cryptographic State Monitor**: Displays real-time states (`Waiting for verification`, `Verification successful`, `Integrity verified`, `Integrity mismatch`, `Blockchain proof verified`, etc.).

### 4. Admin Dashboard & Analytics Engine (`/api/admin/analytics`)
- **Summary Metrics**: Real-time aggregation of registered users, active users (30d), total encrypted documents, active/standard/blockchain transfers, access success/denial ratio, expired/revoked shares, storage usage, and security threats.
- **Visual Analytics**:
  1. Six-Month Upload and Download Trends (interactive bar charts)
  2. Standard vs. Blockchain Transfer Distribution (interactive visual gauge)
  3. Document Storage Distribution (classified by MIME format)
  4. Successful vs. Denied Access Attempt Ratio
  5. Daily User Activity and Security Event Trends
  6. Blockchain Proof Status Breakdown (Confirmed, Pending, Failed)
  7. Operation-Wise Ledger Comparison

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Database Sync
```bash
npx prisma db push
```

### 3. Smart Contract Compilation & Testing
```bash
npx hardhat test
```

### 4. Deploy Smart Contract Locally
```bash
npx hardhat run scripts/deploy.js
```

### 5. Run Verification & Concurrency Test Suite
```bash
node scripts/verify-transfers.js
```

### 6. Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the portal.
Open [http://localhost:3000/recovery](http://localhost:3000/recovery) for the Document Recovery Portal.

---

## 🔒 Security Principles

- **Zero-Exposure Key Management**: Raw encryption keys are never stored in databases, logs, URLs, or blockchain. Keys are managed via KMS envelope encryption and delivered only to authorized recipients upon backend policy approval.
- **Off-Chain Confidentiality**: Actual files, filenames, passwords, and private keys never touch the blockchain.
- **Atomic Concurrency**: Download limits (e.g. `maxDownloads = 1`) use atomic database transactions to guarantee race-condition immunity.
- **Tamper-Evident Integrity**: SHA-256 integrity verification is strictly enforced before any recovered document is presented.
- **Defense in Depth**: Combines client-side cryptography, server-side policy evaluation, AI anomaly detection, and tamper-evident audit chaining.

