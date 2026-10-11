"use client";

import React, { useState, useRef } from "react";
import {
  Shield, Key, Download, Lock, CheckCircle2, AlertTriangle, AlertOctagon,
  Image as ImageIcon, RefreshCw, Eye, ExternalLink, ArrowRight, FileCheck,
  Check, XCircle, Globe, Fingerprint, Layers
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { decryptFileBuffer, computeSHA256Buffer } from "@/lib/crypto";
import { extractPayloadFromImageData } from "@/lib/steganography";

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
  const [geoCountry, setGeoCountry] = useState("US");

  // Recovery execution states
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>("IDLE");
  const [statusMessage, setStatusMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);

  // Integrity telemetry
  const [computedPlaintextHash, setComputedPlaintextHash] = useState<string | null>(null);
  const [expectedOriginalHash, setExpectedOriginalHash] = useState<string | null>(null);

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

    try {
      const res = await fetch(`/api/share/download?id=${encodeURIComponent(extractedId)}&geo=${geoCountry}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to locate document metadata");
      }

      setLinkMeta(data);
      if (data.status === "REVOKED") {
        setRecoveryStatus("TRANSFER_REVOKED");
        setStatusMessage("This transfer has been revoked by the owner.");
      } else if (data.status === "EXPIRED") {
        setRecoveryStatus("TRANSFER_EXPIRED");
        setStatusMessage("This transfer has expired and can no longer be recovered.");
      } else {
        setRecoveryStatus("WAITING_VERIFICATION");
        setStatusMessage("Transfer located. Complete policy authentication to authorize document recovery.");
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

  // Execute Authorized Recovery & Decryption
  const handleExecuteRecovery = async () => {
    if (!linkId) return;
    setIsProcessing(true);
    setProgressPercent(15);
    setStatusMessage("Submitting access credentials to AccessPolicyEngine...");

    try {
      const res = await fetch("/api/share/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: linkId,
          password: passwordInput || null,
          otpCode: otpInput || null,
          geo: geoCountry,
          email: claimedEmail || null,
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
      setProgressPercent(45);

      // Extract DEK from KMS response header or user input
      const kmsReleasedKey = res.headers.get("x-payload-key");
      const expectedOrigHash = res.headers.get("x-original-hash");
      const activeDecryptionKey = kmsReleasedKey || hexKeyInput.trim();

      if (!activeDecryptionKey) {
        throw new Error("Decryption key unavailable. Provide the hex key token or ensure the document has KMS envelope enabled.");
      }

      const fileBuffer = await res.arrayBuffer();
      setProgressPercent(70);
      setStatusMessage("Decrypting document payload locally with Web Crypto (AES-256-GCM)...");

      const decryptedBuffer = await decryptFileBuffer(fileBuffer, activeDecryptionKey);
      setProgressPercent(85);
      setStatusMessage("Performing cryptographic SHA-256 document integrity check...");

      // Compute plaintext SHA-256 hash
      const computedHash = await computeSHA256Buffer(decryptedBuffer);
      setComputedPlaintextHash(computedHash);
      setExpectedOriginalHash(expectedOrigHash);

      // Verify integrity against expected original hash
      if (expectedOrigHash && expectedOrigHash.toLowerCase() !== computedHash.toLowerCase()) {
        setRecoveryStatus("INTEGRITY_MISMATCH");
        throw new Error("CRITICAL INTEGRITY MISMATCH! Computed SHA-256 hash does not match original document signature.");
      }

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
      setStatusMessage("Document integrity cryptographically confirmed. Initiating secure file save...");

      // Download file to client
      let fileName = "recovered_document.bin";
      if (linkMeta?.file?.fileName) {
        try {
          fileName = window.atob(linkMeta.file.fileName);
        } catch {}
      }

      const blob = new Blob([decryptedBuffer], {
        type: linkMeta?.file?.mimeType || "application/octet-stream",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

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
              {linkMeta?.hasRecipientBinding && (
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

              {linkMeta?.passwordRequired && (
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

              {linkMeta?.otpRequired && (
                <div>
                  <label className="text-xs font-mono text-text-secondary block mb-1">One-Time Passcode (OTP)</label>
                  <input
                    type="text"
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="6-digit verification code"
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

            {/* Secure Download / Decrypt Action */}
            <button
              onClick={handleExecuteRecovery}
              disabled={
                !linkMeta ||
                isProcessing ||
                recoveryStatus === "ACCESS_DENIED" ||
                recoveryStatus === "TRANSFER_EXPIRED" ||
                recoveryStatus === "TRANSFER_REVOKED"
              }
              className={`w-full py-3.5 rounded-xl font-mono text-xs font-bold transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
                !linkMeta || isProcessing
                  ? "bg-indigo-600/30 text-indigo-300/40 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25"
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Reconstructing & Verifying...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Authorize & Recover Document
                </>
              )}
            </button>
          </div>

          {/* Cryptographic Proof Verification Results */}
          {computedPlaintextHash && (
            <div className="p-5 rounded-2xl bg-cyber-card border border-border-primary shadow-xl space-y-3 font-mono text-xs">
              <div className="flex items-center gap-2 text-emerald-400">
                <FileCheck className="w-4 h-4" />
                <span className="font-bold uppercase tracking-wider">SHA-256 Document Signature</span>
              </div>
              <div className="p-3 rounded-xl bg-cyber-dark border border-border-primary space-y-1.5">
                <div className="text-[10px] text-text-secondary uppercase">Computed Document Hash</div>
                <div className="text-[11px] text-emerald-300 break-all select-all">{computedPlaintextHash}</div>
              </div>
              {expectedOriginalHash && (
                <div className="p-3 rounded-xl bg-cyber-dark border border-border-primary space-y-1.5">
                  <div className="text-[10px] text-text-secondary uppercase">Expected Master Hash</div>
                  <div className="text-[11px] text-indigo-300 break-all select-all">{expectedOriginalHash}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
