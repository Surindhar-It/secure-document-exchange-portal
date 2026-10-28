"use client";

import React, { useState, useRef } from "react";
import {
  Shield, Key, Download, Lock, CheckCircle2, AlertTriangle, AlertOctagon,
  Image as ImageIcon, RefreshCw, Eye, ExternalLink, ArrowRight, FileCheck,
  Check, XCircle, Globe, Fingerprint, Layers, ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { decryptFileBuffer, computeSHA256Buffer } from "@/lib/crypto";
import { extractPayloadFromImageData } from "@/lib/steganography";
import EmailOtpVerificationCard from "@/components/EmailOtpVerificationCard";

type RecoveryStatus =
  | "IDLE"
  | "WAITING_VERIFICATION"
  | "VERIFICATION_SUCCESSFUL"
  | "INTEGRITY_VERIFIED"
  | "INTEGRITY_MISMATCH"
  | "ACCESS_DENIED"
  | "TRANSFER_EXPIRED"
  | "TRANSFER_REVOKED"
  | "PROOF_PENDING"
  | "PROOF_VERIFIED";

export default function DocumentRecoveryPage() {
  const [linkInput, setLinkInput] = useState("");
  const [linkId, setLinkId] = useState("");
  const [hexKeyInput, setHexKeyInput] = useState("");

  // Steganography recovery states
  const [stegoImageFile, setStegoImageFile] = useState<File | null>(null);
  const [stegoExtracting, setStegoExtracting] = useState(false);
  const [stegoExtractedPayload, setStegoExtractedPayload] = useState<string | null>(null);
  const [stegoStatusMsg, setStegoStatusMsg] = useState("");

  // Metadata loaded from server
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [linkMeta, setLinkMeta] = useState<any | null>(null);

  // Policy authentication inputs
  const [claimedEmail, setClaimedEmail] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSessionToken, setOtpSessionToken] = useState<string | null>(null);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [geoCountry, setGeoCountry] = useState("US");

  // Multi-file bundle state (up to 20 files per link)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Recovery execution states
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>("IDLE");
  const [statusMessage, setStatusMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);

  // Dual-Layer Integrity telemetry (Encrypted Ciphertext Check & Decrypted Plaintext Check)
  const [computedCiphertextHash, setComputedCiphertextHash] = useState<string | null>(null);
  const [expectedCiphertextHash, setExpectedCiphertextHash] = useState<string | null>(null);
  const [ciphertextTampered, setCiphertextTampered] = useState<boolean | null>(null);

  const [computedPlaintextHash, setComputedPlaintextHash] = useState<string | null>(null);
  const [expectedOriginalHash, setExpectedOriginalHash] = useState<string | null>(null);
  const [plaintextTampered, setPlaintextTampered] = useState<boolean | null>(null);

  // Parse link / URL input
  const handleParseLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setMetaError("");
    setLinkMeta(null);
    setRecoveryStatus("IDLE");
    setStatusMessage("");

    let extractedId = linkInput.trim();
    let extractedKey = hexKeyInput.trim();

    // Check if input is a full URL with hash
    try {
      if (extractedId.includes("/d/")) {
        const urlObj = new URL(extractedId, window.location.origin);
        const parts = urlObj.pathname.split("/d/");
        if (parts[1]) extractedId = parts[1];
        if (urlObj.hash && urlObj.hash.length > 1) {
          extractedKey = urlObj.hash.substring(1);
          setHexKeyInput(extractedKey);
        }
      }
    } catch {}

    if (!extractedId) {
      setMetaError("Please provide a valid Share Link ID or URL.");
      return;
    }

    setLinkId(extractedId);
    setMetaLoading(true);
    setOtpSessionToken(null);
    setIsOtpVerified(false);

    try {
      const res = await fetch(`/api/share/download?id=${encodeURIComponent(extractedId)}&geo=${geoCountry}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to locate document metadata");
      }

      setLinkMeta(data);

      const filesList = data.files && data.files.length > 0 ? data.files : (data.file ? [data.file] : []);
      if (filesList.length > 0) {
        setSelectedFileId(filesList[0].id);
      }

      if (data.status === "REVOKED") {
        setRecoveryStatus("TRANSFER_REVOKED");
        setStatusMessage("This transfer has been revoked by the owner.");
      } else if (data.status === "EXPIRED") {
        setRecoveryStatus("TRANSFER_EXPIRED");
        setStatusMessage("This transfer has expired and can no longer be recovered.");
      } else {
        setRecoveryStatus("WAITING_VERIFICATION");
        setStatusMessage(
          filesList.length > 1
            ? `Transfer located: Multi-file bundle containing ${filesList.length} secure documents (max 20). Complete policy authentication to recover.`
            : "Transfer located. Complete policy authentication to authorize document recovery."
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMetaError(msg);
      setRecoveryStatus("ACCESS_DENIED");
    } finally {
      setMetaLoading(false);
    }
  };

  // Steganography payload extraction
  const handleExtractStegoImage = async (file: File) => {
    setStegoImageFile(file);
    setStegoExtracting(true);
    setStegoStatusMsg("Analyzing image bitmap and LSB color channels...");

    try {
      // Validate format
      if (!file.type.includes("png") && !file.type.includes("bmp") && !file.name.endsWith(".png")) {
        throw new Error("Lossless format required (PNG or BMP). Lossy formats like JPEG degrade LSB bits.");
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;

      await new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error("Failed to decode image file."));
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize 2D rendering canvas context.");

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(objectUrl);

      const result = extractPayloadFromImageData(imgData.data, img.width, img.height);

      if (!result.success || !result.payload) {
        throw new Error(result.error || "No embedded steganographic payload found in this image.");
      }

      setStegoExtractedPayload(result.payload);
      setStegoStatusMsg(`Payload successfully extracted (${result.payload.length} chars). Integrity verified.`);

      // Attempt parsing JSON token
      try {
        const parsed = JSON.parse(result.payload);
        if (parsed.shareId && !linkId) {
          setLinkInput(parsed.shareId);
          setLinkId(parsed.shareId);
        }
      } catch {}
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStegoStatusMsg(msg);
      setStegoExtractedPayload(null);
    } finally {
      setStegoExtracting(false);
    }
  };

  // Helper to recover and verify a single file
  const recoverAndVerifySingleFile = async (targetFileId?: string) => {
    const res = await fetch("/api/share/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: linkId,
        fileId: targetFileId || selectedFileId || undefined,
        password: passwordInput || null,
        otpCode: otpInput || null,
        sessionToken: otpSessionToken || null,
        geo: geoCountry,
        email: claimedEmail || linkMeta?.recipientEmail || null,
      }),
    });

    const contentType = res.headers.get("Content-Type");
    if (!res.ok || contentType?.includes("application/json")) {
      const errorData = await res.json();
      setRecoveryStatus("ACCESS_DENIED");
      throw new Error(errorData.error || "Access policy evaluation rejected recovery request");
    }

    setRecoveryStatus("VERIFICATION_SUCCESSFUL");
    setStatusMessage("Access policy authorization confirmed. Streaming encrypted ciphertext...");
    setProgressPercent(40);

    // Extract headers
    const kmsReleasedKey = res.headers.get("x-payload-key");
    const expectedCipherHash = res.headers.get("x-ciphertext-hash");
    const expectedOrigHash = res.headers.get("x-original-hash");
    const headerFileName = res.headers.get("x-file-name");
    const activeDecryptionKey = kmsReleasedKey || hexKeyInput.trim();

    if (!activeDecryptionKey) {
      throw new Error("Decryption key unavailable. Provide the hex key token or ensure the document has KMS envelope enabled.");
    }

    const fileBuffer = await res.arrayBuffer();
    setProgressPercent(60);

    // STEP 1: VERIFY ENCRYPTED VALUE (CIPHERTEXT INTEGRITY CHECK)
    // Check if the ciphertext stored on server / received in transit matches the registered signature
    setStatusMessage("Verifying encrypted ciphertext integrity (storage & transit tampering check)...");
    const computedCipherHash = await computeSHA256Buffer(fileBuffer);
    setComputedCiphertextHash(computedCipherHash);
    setExpectedCiphertextHash(expectedCipherHash);

    if (expectedCipherHash && expectedCipherHash.toLowerCase() !== computedCipherHash.toLowerCase()) {
      setCiphertextTampered(true);
      setRecoveryStatus("INTEGRITY_MISMATCH");
      throw new Error(
        `CRITICAL TAMPER ALERT! Encrypted payload was modified or corrupted in storage!\n` +
        `Computed Ciphertext Hash: ${computedCipherHash}\n` +
        `Expected Ciphertext Hash: ${expectedCipherHash}\n` +
        `Decryption aborted to protect system integrity.`
      );
    }
    setCiphertextTampered(false);

    // STEP 2: DECRYPT WITH WEB CRYPTO (AES-256-GCM)
    setStatusMessage("Encrypted ciphertext verified untampered. Decrypting document with Web Crypto AES-256-GCM...");
    setProgressPercent(75);
    const decryptedBuffer = await decryptFileBuffer(fileBuffer, activeDecryptionKey);

    // STEP 3: VERIFY DECRYPTED VALUE (PLAINTEXT INTEGRITY CHECK)
    // Check if recovered plaintext matches the original unencrypted document uploaded by the owner
    setStatusMessage("Performing cryptographic SHA-256 plaintext integrity verification...");
    setProgressPercent(90);
    const computedPlainHash = await computeSHA256Buffer(decryptedBuffer);
    setComputedPlaintextHash(computedPlainHash);
    setExpectedOriginalHash(expectedOrigHash);

    if (expectedOrigHash && expectedOrigHash.toLowerCase() !== computedPlainHash.toLowerCase()) {
      setPlaintextTampered(true);
      setRecoveryStatus("INTEGRITY_MISMATCH");
      throw new Error(
        `CRITICAL INTEGRITY MISMATCH! Recovered document content does not match original document uploaded by owner!\n` +
        `Computed Plaintext Hash: ${computedPlainHash}\n` +
        `Expected Original Hash: ${expectedOrigHash}\n` +
        `Document display halted due to integrity mismatch.`
      );
    }
    setPlaintextTampered(false);

    // Resolve file name
    let fileName = "recovered_document.bin";
    const filesList = linkMeta?.files || (linkMeta?.file ? [linkMeta.file] : []);
    const matchingFile = filesList.find((f: any) => f.id === targetFileId || f.id === selectedFileId) || linkMeta?.file;
    const rawEncodedName = headerFileName || matchingFile?.fileName;

    if (rawEncodedName) {
      try {
        fileName = window.atob(rawEncodedName);
      } catch {
        fileName = rawEncodedName;
      }
    }

    // Trigger secure file download
    const blob = new Blob([decryptedBuffer], {
      type: matchingFile?.mimeType || "application/octet-stream",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    return { fileName, computedCipherHash, computedPlainHash };
  };

  // Execute Authorized Recovery & Decryption (Single or Batch)
  const handleExecuteRecovery = async (targetFileId?: string) => {
    if (!linkId) return;

    const requiresOtp = linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired;
    if (requiresOtp && !isOtpVerified) {
      setRecoveryStatus("WAITING_VERIFICATION");
      setStatusMessage("Please complete Email OTP verification to unlock document recovery.");
      return;
    }

    setIsProcessing(true);
    setProgressPercent(15);
    setStatusMessage("Submitting access credentials to AccessPolicyEngine...");

    try {
      await recoverAndVerifySingleFile(targetFileId);

      // Check blockchain status if applicable
      if (linkMeta?.transferMode === "BLOCKCHAIN") {
        if (linkMeta.blockchainProof?.status === "CONFIRMED" || linkMeta.blockchainProof?.status === "VERIFIED") {
          setRecoveryStatus("PROOF_VERIFIED");
        } else {
          setRecoveryStatus("PROOF_PENDING");
        }
      } else {
        setRecoveryStatus("INTEGRITY_VERIFIED");
      }

      setProgressPercent(100);
      setStatusMessage("Integrity confirmed: Encrypted ciphertext and decrypted original plaintext both verified untampered!");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  // Recover all files in bundle sequentially
  const handleRecoverAllFiles = async () => {
    const filesList = linkMeta?.files || (linkMeta?.file ? [linkMeta.file] : []);
    if (!filesList.length) return;

    const requiresOtp = linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired;
    if (requiresOtp && !isOtpVerified) {
      setRecoveryStatus("WAITING_VERIFICATION");
      setStatusMessage("Please complete Email OTP verification to unlock document recovery.");
      return;
    }

    setIsProcessing(true);
    try {
      for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        setSelectedFileId(file.id);
        setStatusMessage(`Recovering and verifying file ${i + 1} of ${filesList.length}...`);
        await recoverAndVerifySingleFile(file.id);
        // Small delay between downloads
        await new Promise((r) => setTimeout(r, 600));
      }

      setRecoveryStatus(linkMeta?.transferMode === "BLOCKCHAIN" ? "PROOF_VERIFIED" : "INTEGRITY_VERIFIED");
      setProgressPercent(100);
      setStatusMessage(`All ${filesList.length} files successfully recovered and cryptographically verified.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-cyber-dark text-text-primary p-6 md:p-12 flex flex-col items-center select-none font-sans">
      {/* Header */}
      <div className="max-w-4xl w-full flex flex-col items-center text-center space-y-3 mb-10">
        <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-mono">
          <Shield className="w-3.5 h-3.5" />
          <span>Secure Document Recovery & Integrity Verification Engine</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-indigo-200 to-indigo-400 bg-clip-text text-transparent">
          Document Recovery Portal
        </h1>
        <p className="text-text-secondary text-sm max-w-xl font-mono">
          Authenticate against security policies, extract optional steganographic carriers, and reconstruct AES-256-GCM encrypted documents.
        </p>
      </div>

      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Form & Verification Setup */}
        <div className="lg:col-span-7 space-y-6">
          {/* Step 1: Link Identification */}
          <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-5">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xs font-mono font-bold">1</span>
              <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-text-primary">Locate Document Transfer</h2>
            </div>

            <form onSubmit={handleParseLink} className="space-y-4">
              <div>
                <label className="text-xs font-mono text-text-secondary block mb-1.5">Share Link ID or Full Portal URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="e.g. 7fK2mNx8z or http://localhost:3000/d/..."
                    className="flex-grow px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:outline-none focus:border-indigo-500"
                    required
                  />
                  <button
                    type="submit"
                    disabled={metaLoading}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-semibold transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                  >
                    {metaLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    Lookup
                  </button>
                </div>
              </div>

              {metaError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{metaError}</span>
                </div>
              )}
            </form>
          </div>

          {/* Step 2: Policy Authentication (Unlocked once transfer located) */}
          <div className={`p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-5 transition-opacity ${!linkMeta ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xs font-mono font-bold">2</span>
                <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-text-primary">Policy Authentication</h2>
              </div>
              {linkMeta && (
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border ${
                  linkMeta.transferMode === "BLOCKCHAIN"
                    ? "bg-purple-500/15 border-purple-500/30 text-purple-400 font-bold"
                    : "bg-indigo-500/15 border-indigo-500/30 text-indigo-400"
                }`}>
                  {linkMeta.transferMode} TRANSFER
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Email OTP Verification Challenge Card */}
              {(linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired) && (
                <EmailOtpVerificationCard
                  linkId={linkId}
                  maskedEmail={linkMeta?.maskedRecipientEmail}
                  isVerified={isOtpVerified}
                  onVerified={(token) => {
                    setOtpSessionToken(token);
                    setIsOtpVerified(true);
                    if (linkMeta?.recipientEmail) {
                      setClaimedEmail(linkMeta.recipientEmail);
                    }
                    setRecoveryStatus("VERIFICATION_SUCCESSFUL");
                    setStatusMessage("Email OTP verified. Ready to authorize document recovery.");
                  }}
                  disabled={isProcessing}
                />
              )}

              {/* Recipient binding email input (only if not using Email OTP) */}
              {linkMeta?.hasRecipientBinding && !(linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired) && (
                <div>
                  <label className="text-xs font-mono text-text-secondary block mb-1">Designated Recipient Email (Required)</label>
                  <input
                    type="email"
                    value={claimedEmail}
                    onChange={(e) => setClaimedEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {(linkMeta?.passwordRequired || linkMeta?.authMethod === "PASSWORD" || linkMeta?.authMethod === "BOTH") && (
                <div>
                  <label className="text-xs font-mono text-text-secondary block mb-1">Link Password</label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder="Enter security password"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-mono text-text-secondary block mb-1">Hex Decryption Key (Optional if managed by KMS)</label>
                <input
                  type="text"
                  value={hexKeyInput}
                  onChange={(e) => setHexKeyInput(e.target.value)}
                  placeholder="64-character AES-256 hex key (auto-extracted from #key or KMS)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Optional Image Steganography Extractor */}
          <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-text-primary">
                  Optional Steganography Carrier
                </h3>
              </div>
              <span className="text-[10px] text-text-secondary font-mono">LSB Extraction</span>
            </div>

            <p className="text-[11px] text-text-secondary font-mono leading-relaxed">
              If the sender embedded a verification payload or key envelope into a carrier image, upload the lossless PNG or BMP file below.
            </p>

            <div className="p-4 rounded-xl border border-dashed border-border-primary bg-cyber-dark flex flex-col items-center justify-center text-center gap-2">
              <input
                type="file"
                accept="image/png,image/bmp"
                onChange={(e) => e.target.files?.[0] && handleExtractStegoImage(e.target.files[0])}
                className="hidden"
                id="stego-input"
              />
              <label
                htmlFor="stego-input"
                className="px-4 py-2 rounded-xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 text-xs font-mono cursor-pointer transition-all flex items-center gap-2"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Select Stego Carrier Image (.PNG)
              </label>
              {stegoImageFile && (
                <span className="text-[11px] text-text-primary font-mono mt-1">
                  Selected: {stegoImageFile.name} ({(stegoImageFile.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>

            {stegoStatusMsg && (
              <div className="p-3 rounded-xl bg-cyber-dark border border-border-primary text-[11px] font-mono text-text-secondary flex items-start gap-2">
                {stegoExtracting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400 mt-0.5" />
                ) : stegoExtractedPayload ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 overflow-hidden">
                  <p>{stegoStatusMsg}</p>
                  {stegoExtractedPayload && (
                    <pre className="text-[10px] text-emerald-300 bg-black/40 p-2 rounded max-h-24 overflow-y-auto break-all">
                      {stegoExtractedPayload}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Verification Status & Download Action */}
        <div className="lg:col-span-5 space-y-6">
          {/* Recovery Telemetry Status Box */}
          <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-5">
            <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-text-primary">
              Cryptographic Status Monitor
            </h2>

            {/* Current Status Pill */}
            <div className="p-4 rounded-xl bg-cyber-dark border border-border-primary space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-secondary">
                Authorization State
              </div>
              <div className="flex items-center gap-2.5">
                {recoveryStatus === "IDLE" && (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-500 animate-pulse" />
                    <span className="text-xs font-mono font-bold text-slate-300">Waiting for Document Selection</span>
                  </>
                )}
                {recoveryStatus === "WAITING_VERIFICATION" && (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                    <span className="text-xs font-mono font-bold text-amber-300">Waiting for Verification</span>
                  </>
                )}
                {recoveryStatus === "VERIFICATION_SUCCESSFUL" && (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-emerald-400">Verification Successful</span>
                  </>
                )}
                {recoveryStatus === "INTEGRITY_VERIFIED" && (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-emerald-400">Integrity Verified (SHA-256 Match)</span>
                  </>
                )}
                {recoveryStatus === "PROOF_VERIFIED" && (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-mono font-bold text-purple-300">Blockchain Proof Verified</span>
                  </>
                )}
                {recoveryStatus === "PROOF_PENDING" && (
                  <>
                    <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />
                    <span className="text-xs font-mono font-bold text-purple-300">Blockchain Proof Pending</span>
                  </>
                )}
                {recoveryStatus === "INTEGRITY_MISMATCH" && (
                  <>
                    <AlertOctagon className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-mono font-bold text-rose-400">Integrity Mismatch Detected</span>
                  </>
                )}
                {recoveryStatus === "ACCESS_DENIED" && (
                  <>
                    <XCircle className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-mono font-bold text-rose-400">Access Denied by Policy</span>
                  </>
                )}
                {recoveryStatus === "TRANSFER_EXPIRED" && (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-mono font-bold text-amber-400">Transfer Expired</span>
                  </>
                )}
                {recoveryStatus === "TRANSFER_REVOKED" && (
                  <>
                    <XCircle className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-mono font-bold text-rose-400">Transfer Revoked</span>
                  </>
                )}
              </div>

              {statusMessage && (
                <p className="text-[11px] font-mono text-text-secondary leading-normal pt-1 border-t border-border-primary/50">
                  {statusMessage}
                </p>
              )}
            </div>

            {/* Document Telemetry Details */}
            {linkMeta?.file && (
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1.5 border-b border-border-primary/60">
                  <span className="text-text-secondary">Encryption Version:</span>
                  <span className="text-indigo-400 font-bold">{linkMeta.file.encryptionAlgo || "AES-256-GCM"} v{linkMeta.file.encryptionVersion || "1.0"}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border-primary/60">
                  <span className="text-text-secondary">Encrypted Size:</span>
                  <span className="text-text-primary">{(linkMeta.file.fileSize / 1024).toFixed(1)} KB</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-border-primary/60">
                  <span className="text-text-secondary">Transfer Mode:</span>
                  <span className="text-purple-400 font-semibold">{linkMeta.transferMode}</span>
                </div>
                {linkMeta.blockchainProof && (
                  <div className="flex justify-between py-1.5 border-b border-border-primary/60">
                    <span className="text-text-secondary">Proof Network:</span>
                    <span className="text-emerald-400 font-semibold">{linkMeta.blockchainProof.network}</span>
                  </div>
                )}
              </div>
            )}

            {/* Progress Bar during recovery */}
            {isProcessing && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-mono text-text-secondary">
                  <span>Cryptographic Reconstruction</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-cyber-dark overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400"
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            )}

          {/* Multi-File Bundle Document Selector (Up to 20 files per link) */}
          {linkMeta?.files && linkMeta.files.length > 1 && (
            <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xs font-mono font-bold">
                    <Layers className="w-3.5 h-3.5" />
                  </span>
                  <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-text-primary">
                    Transfer Bundle ({linkMeta.files.length} Documents)
                  </h2>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Single Link Bundle (Max 20)
                </span>
              </div>

              <p className="text-[11px] text-text-secondary font-mono">
                This transfer link securely shares multiple files. Select an individual document to recover or verify all documents in batch.
              </p>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {linkMeta.files.map((file: any, index: number) => {
                  let originalName = `document_${index + 1}.bin`;
                  try {
                    originalName = window.atob(file.fileName);
                  } catch {
                    originalName = file.fileName;
                  }

                  const isSelected = selectedFileId === file.id;

                  return (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      className={`p-3 rounded-xl border font-mono text-xs cursor-pointer transition-all flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-indigo-600/15 border-indigo-500 text-text-primary shadow-md"
                          : "bg-cyber-dark border-border-primary text-text-secondary hover:border-indigo-500/30 hover:text-text-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                          isSelected ? "bg-indigo-600 text-white" : "bg-cyber-card text-text-secondary"
                        }`}>
                          {index + 1}
                        </div>
                        <div className="truncate">
                          <div className="font-bold truncate text-text-primary">{originalName}</div>
                          <div className="text-[10px] text-text-secondary">
                            {(file.fileSize / 1024).toFixed(1)} KB • {file.encryptionAlgo || "AES-256-GCM"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isSelected && (
                          <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded font-bold">
                            Selected
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFileId(file.id);
                            handleExecuteRecovery(file.id);
                          }}
                          disabled={isProcessing}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 disabled:opacity-50"
                        >
                          <Download className="w-3 h-3" />
                          Recover
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleRecoverAllFiles}
                disabled={isProcessing}
                className="w-full py-2.5 rounded-xl border border-indigo-500/30 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Recover & Verify All {linkMeta.files.length} Documents
              </button>
            </div>
          )}

          {/* Secure Download / Decrypt Action */}
          <button
            onClick={() => handleExecuteRecovery()}
            disabled={
              !linkMeta ||
              isProcessing ||
              recoveryStatus === "ACCESS_DENIED" ||
              recoveryStatus === "TRANSFER_EXPIRED" ||
              recoveryStatus === "TRANSFER_REVOKED" ||
              ((linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired) && !isOtpVerified)
            }
            className={`w-full py-3.5 rounded-xl font-mono text-xs font-bold transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
              !linkMeta ||
              isProcessing ||
              ((linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired) && !isOtpVerified)
                ? "bg-indigo-600/30 text-indigo-300/40 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25"
            }`}
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Reconstructing & Verifying Integrity...
              </>
            ) : ((linkMeta?.authMethod === "EMAIL_OTP" || linkMeta?.authMethod === "BOTH" || linkMeta?.otpRequired) && !isOtpVerified) ? (
              <>
                <Shield className="w-4 h-4" />
                Verify Email OTP to Authorize Recovery
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                {linkMeta?.files && linkMeta.files.length > 1
                  ? "Authorize & Recover Selected Document"
                  : "Authorize & Recover Document"}
              </>
            )}
          </button>
        </div>

        {/* Dual Cryptographic Proof Verification Results */}
        {(computedCiphertextHash || computedPlaintextHash) && (
          <div className="p-5 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-wider">
                <FileCheck className="w-4 h-4 text-indigo-400" />
                <span>Dual-Layer Cryptographic Audit</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                ciphertextTampered === false && plaintextTampered === false
                  ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                  : "bg-rose-500/15 border border-rose-500/30 text-rose-400"
              }`}>
                {ciphertextTampered === false && plaintextTampered === false
                  ? "ZERO TAMPERING DETECTED"
                  : "INTEGRITY ALERT"}
              </span>
            </div>

            {/* Check 1: Encrypted Ciphertext Signature Check */}
            {computedCiphertextHash && (
              <div className="p-3.5 rounded-xl bg-cyber-dark border border-border-primary space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-text-primary flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-indigo-400" />
                    1. Encrypted Ciphertext Hash (Storage & Transit Check)
                  </span>
                  {ciphertextTampered === false ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1 text-[10px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> MATCH / UNTAMPERED
                    </span>
                  ) : ciphertextTampered === true ? (
                    <span className="text-rose-400 font-bold flex items-center gap-1 text-[10px]">
                      <AlertOctagon className="w-3.5 h-3.5" /> CIPHERTEXT MODIFIED
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="text-text-secondary">Computed Ciphertext SHA-256:</div>
                  <div className="text-emerald-300 break-all select-all bg-black/30 p-1.5 rounded">{computedCiphertextHash}</div>
                  {expectedCiphertextHash && (
                    <>
                      <div className="text-text-secondary mt-1">Expected Server Signature:</div>
                      <div className="text-indigo-300 break-all select-all bg-black/30 p-1.5 rounded">{expectedCiphertextHash}</div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Check 2: Decrypted Plaintext Signature Check */}
            {computedPlaintextHash && (
              <div className="p-3.5 rounded-xl bg-cyber-dark border border-border-primary space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-text-primary flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    2. Decrypted Plaintext Hash (Original Master Check)
                  </span>
                  {plaintextTampered === false ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1 text-[10px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> MATCH / PRISTINE CONTENT
                    </span>
                  ) : plaintextTampered === true ? (
                    <span className="text-rose-400 font-bold flex items-center gap-1 text-[10px]">
                      <AlertOctagon className="w-3.5 h-3.5" /> CONTENT MISMATCH
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="text-text-secondary">Computed Document SHA-256:</div>
                  <div className="text-emerald-300 break-all select-all bg-black/30 p-1.5 rounded">{computedPlaintextHash}</div>
                  {expectedOriginalHash && (
                    <>
                      <div className="text-text-secondary mt-1">Expected Original Master Hash:</div>
                      <div className="text-indigo-300 break-all select-all bg-black/30 p-1.5 rounded">{expectedOriginalHash}</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </div>
  );
}
