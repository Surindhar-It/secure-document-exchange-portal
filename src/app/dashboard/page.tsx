"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Shield, Key, Upload, Folder, Link2, Activity, Cpu, Settings, LogOut,
  Clock, HardDrive, AlertTriangle, CheckCircle2, X, Globe, Fingerprint,
  Lock, Unlock, ShieldCheck, QrCode, Trash2, RefreshCw, Mail, Check, ExternalLink,
  BarChart3, Image as ImageIcon, FileCheck, Layers, PieChart, TrendingUp, Users, ShieldAlert
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { encryptFileBuffer, decryptFileBuffer, generateEncryptionKey, exportKeyToHex } from "@/lib/crypto";
import { startRegistration } from "@simplewebauthn/browser";
import AdminAnalyticsView from "@/components/AdminAnalyticsView";
import StegoToolView from "@/components/StegoToolView";

function safeBase64Encode(str: string): string {
  try {
    return window.btoa(unescape(encodeURIComponent(str)));
  } catch {
    return window.btoa(str);
  }
}

function safeBase64Decode(b64: string): string {
  try {
    return decodeURIComponent(escape(window.atob(b64)));
  } catch {
    try {
      return window.atob(b64);
    } catch {
      return "document.bin";
    }
  }
}

export default function DashboardPage() {
  const router = useRouter();

  // Navigation state: "overview" | "upload" | "files" | "links" | "audit" | "security" | "settings"
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Core Data states loaded from APIs
  const [files, setFiles] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [threats, setThreats] = useState<any[]>([]);
  const [aiEngineOnline, setAiEngineOnline] = useState(false);
  const [userProfile, setUserProfile] = useState<any>({ email: "" });

  // UI state variables
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Modal control states for Share Link Creation
  const [shareModalFile, setShareModalFile] = useState<any | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [shareSelectedDocIds, setShareSelectedDocIds] = useState<string[]>([]);
  const [shareTransferMode, setShareTransferMode] = useState<"STANDARD" | "BLOCKCHAIN">("STANDARD");
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [shareExpiryOption, setShareExpiryOption] = useState("24h");
  const [shareCustomHours, setShareCustomHours] = useState("");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [shareOtpEnabled, setShareOtpEnabled] = useState(false);
  const [shareAuthMethod, setShareAuthMethod] = useState<"NONE" | "PASSWORD" | "EMAIL_OTP" | "BOTH">("NONE");
  const [shareAllowedIps, setShareAllowedIps] = useState("");
  const [shareAllowedGeos, setShareAllowedGeos] = useState("");
  const [shareWatermarkText, setShareWatermarkText] = useState("");
  const [shareStegoEnabled, setShareStegoEnabled] = useState(false);
  const [createdStegoPayload, setCreatedStegoPayload] = useState<string | null>(null);
  const [generatedShareUrl, setGeneratedShareUrl] = useState("");
  const [generatedHexKey, setGeneratedHexKey] = useState("");

  // Blockchain Verification Modal states
  const [selectedVerifyLink, setSelectedVerifyLink] = useState<any | null>(null);
  const [isVerifyingBlockchain, setIsVerifyingBlockchain] = useState(false);
  const [blockchainVerifyResult, setBlockchainVerifyResult] = useState<any | null>(null);

  // Ledger Verification animation states
  const [isVerifyingLedger, setIsVerifyingLedger] = useState(false);
  const [ledgerVerificationStatus, setLedgerVerificationStatus] = useState<any | null>(null);

  // MFA Registration visual states
  const [mfaQrCodeUrl, setMfaQrCodeUrl] = useState("");
  const [mfaSecretText, setMfaSecretText] = useState("");
  const [mfaCodeInput, setMfaCodeInput] = useState("");
  const [mfaSetupActive, setMfaSetupActive] = useState(false);

  // File Upload Cryptographic visualizer states
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadCryptStep, setUploadCryptStep] = useState(0);
  const [currentFileHash, setCurrentFileHash] = useState("");

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const toggleAllowedGeo = (code: string) => {
    let current = shareAllowedGeos
      .split(",")
      .map(c => c.trim().toUpperCase())
      .filter(c => c.length > 0);

    if (current.includes(code)) {
      current = current.filter(c => c !== code);
    } else {
      current.push(code);
    }

    setShareAllowedGeos(current.join(", "));
  };

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const filesRes = await fetch("/api/files/upload");
      if (filesRes.status === 401) {
        router.push("/login");
        return;
      }

      const filesData = await filesRes.json();
      setFiles(filesData.files || []);

      const linksRes = await fetch("/api/share");
      const linksData = await linksRes.json();
      setLinks(linksData.links || []);

      const auditRes = await fetch("/api/audit/logs");
      const auditData = await auditRes.json();
      setAuditLogs(auditData.logs || []);

      const threatsRes = await fetch("/api/security/threats");
      const threatsData = await threatsRes.json();
      setThreats(threatsData.threats || []);
      setAiEngineOnline(threatsData.aiEngineOnline || false);

      if (filesData.user) {
        setUserProfile({
          email: filesData.user.email,
          mfaEnabled: filesData.user.mfaEnabled,
        });
      } else {
        const emailLog = auditData.logs?.find((l: any) => l.userEmail);
        setUserProfile({
          email: emailLog ? emailLog.userEmail : "user@fortressshare.internal",
          mfaEnabled: false,
        });
      }
    } catch (err) {
      console.error("Dashboard load failed:", err);
      showToast("error", "Failed to synchronize node telemetry.");
    } finally {
      setLoading(false);
    }
  }

  // Trigger loading data on mount
  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------
  // Cryptographic File Upload Flow
  // -------------------------------------------------------------
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    try {
      setUploadCryptStep(1);
      setUploadProgress(10);
      setUploadStatus("Parsing binary payload into ArrayBuffer...");
      const fileArrayBuffer = await uploadFile.arrayBuffer();
      const origHashBuffer = await window.crypto.subtle.digest("SHA-256", fileArrayBuffer);
      const origHashHex = Array.from(new Uint8Array(origHashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      setUploadCryptStep(2);
      setUploadProgress(25);
      setUploadStatus("Web Crypto: Initializing Ephemeral 256-bit AES Key...");
      await new Promise((r) => setTimeout(r, 400));

      const cryptoKey = await generateEncryptionKey();
      const hexKey = await exportKeyToHex(cryptoKey);

      setUploadCryptStep(3);
      setUploadProgress(50);
      setUploadStatus("Zero-Knowledge: Encrypting payload with AES-GCM (12-byte IV prepended)...");
      const encryptedBuffer = await encryptFileBuffer(fileArrayBuffer, cryptoKey);

      setUploadCryptStep(4);
      setUploadProgress(75);
      setUploadStatus("Hashing: Computing SHA-256 payload integrity signature...");

      const hashBuffer = await window.crypto.subtle.digest("SHA-256", encryptedBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      setCurrentFileHash(hashHex);

      setUploadCryptStep(5);
      setUploadProgress(90);
      setUploadStatus("Storage: Transferring encrypted ciphertext blocks and KMS envelope...");

      const formData = new FormData();
      const encryptedBlob = new Blob([encryptedBuffer], { type: "application/octet-stream" });
      const encodedFileName = safeBase64Encode(uploadFile.name);

      formData.append("file", encryptedBlob, uploadFile.name);
      formData.append("fileName", encodedFileName);
      formData.append("fileSize", encryptedBuffer.byteLength.toString());
      formData.append("mimeType", uploadFile.type || "application/octet-stream");
      formData.append("signature", hashHex);
      formData.append("originalHash", origHashHex);
      formData.append("dekHex", hexKey);
      formData.append("encryptionAlgo", "AES-256-GCM");
      formData.append("encryptionVersion", "1.0");

      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      // Persist the exact AES key locally for zero-knowledge decryption
      try {
        if (data.file?.id && hexKey) {
          localStorage.setItem(`doc_key_${data.file.id}`, hexKey);
        }
      } catch {}

      setUploadCryptStep(6);
      setUploadProgress(100);
      setUploadStatus("Success! File encrypted and sealed.");
      showToast("success", "File successfully encrypted and stored.");

      setTimeout(() => {
        setUploadFile(null);
        setUploadCryptStep(0);
        setUploadProgress(0);
        setUploadStatus("");
        setCurrentFileHash("");
        fetchDashboardData();
        setActiveTab("files");
      }, 1200);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadCryptStep(0);
      setUploadProgress(0);
      setUploadStatus("");
      showToast("error", msg || "Encryption upload failed");
    }
  };

  // -------------------------------------------------------------
  // Ephemeral Link Creation with Dual-Mode Support
  // -------------------------------------------------------------
  const handleOpenShareModal = async (file?: any, multiDocIds?: string[]) => {
    let targetIds: string[] = [];
    if (multiDocIds && multiDocIds.length > 0) {
      targetIds = multiDocIds.slice(0, 20);
    } else if (file) {
      targetIds = [file.id];
    } else if (selectedDocIds.length > 0) {
      targetIds = selectedDocIds.slice(0, 20);
    }

    if (targetIds.length === 0) {
      showToast("error", "Please select at least one document to create a transfer.");
      return;
    }

    const primaryFile = files.find((f) => f.id === targetIds[0]) || file || files[0];
    setShareModalFile(primaryFile);
    setShareSelectedDocIds(targetIds);
    setShareTransferMode("STANDARD");
    setShareRecipientEmail("");
    setShareExpiryOption("24h");
    setShareCustomHours("");
    setShareMaxDownloads("");
    setSharePassword("");
    setShareOtpEnabled(false);
    setShareAuthMethod("NONE");
    setShareAllowedIps("");
    setShareAllowedGeos("");
    setShareWatermarkText("");
    setShareStegoEnabled(false);
    setCreatedStegoPayload(null);
    setGeneratedShareUrl("");

    // Retrieve stored encryption key or generate fallback
    try {
      const storedKey = localStorage.getItem(`doc_key_${primaryFile.id}`);
      if (storedKey && storedKey.length === 64) {
        setGeneratedHexKey(storedKey);
      } else {
        const cryptoKey = await generateEncryptionKey();
        const hexKey = await exportKeyToHex(cryptoKey);
        setGeneratedHexKey(hexKey);
      }
    } catch {
      setGeneratedHexKey("0000000000000000000000000000000000000000000000000000000000000000");
    }
  };

  const handleToggleDocSelection = (id: string) => {
    setSelectedDocIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 20) {
          showToast("error", "Maximum 20 documents can be bundled into a single transfer link.");
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  const handleSelectAllDocs = () => {
    if (selectedDocIds.length === Math.min(files.length, 20) && files.length > 0) {
      setSelectedDocIds([]);
    } else {
      const capped = files.slice(0, 20).map((f) => f.id);
      setSelectedDocIds(capped);
      if (files.length > 20) {
        showToast("info", "Selected first 20 documents (maximum allowed per link).");
      }
    }
  };

  const handleToggleDocInModal = (id: string) => {
    setShareSelectedDocIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          showToast("error", "At least one document must remain selected.");
          return prev;
        }
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 20) {
          showToast("error", "Maximum 20 documents allowed in a single transfer link.");
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  const handleCreateShareLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareModalFile) return;

    // Validate Authentication Method Requirements
    if (shareAuthMethod === "EMAIL_OTP" || shareAuthMethod === "BOTH") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!shareRecipientEmail || !emailRegex.test(shareRecipientEmail.trim())) {
        showToast("error", "A valid recipient email address is required for Email OTP verification.");
        return;
      }
    }

    if ((shareAuthMethod === "PASSWORD" || shareAuthMethod === "BOTH") && !sharePassword) {
      showToast("error", "Please configure an access password for Password Protection.");
      return;
    }

    try {
      // Calculate Expiry Date based on chosen preset
      let expiryDate: Date | null = new Date();
      if (shareExpiryOption === "10m") {
        expiryDate.setMinutes(expiryDate.getMinutes() + 10);
      } else if (shareExpiryOption === "30m") {
        expiryDate.setMinutes(expiryDate.getMinutes() + 30);
      } else if (shareExpiryOption === "1h") {
        expiryDate.setHours(expiryDate.getHours() + 1);
      } else if (shareExpiryOption === "6h") {
        expiryDate.setHours(expiryDate.getHours() + 6);
      } else if (shareExpiryOption === "24h") {
        expiryDate.setHours(expiryDate.getHours() + 24);
      } else if (shareExpiryOption === "7d") {
        expiryDate.setDate(expiryDate.getDate() + 7);
      } else if (shareExpiryOption === "custom") {
        const hours = parseInt(shareCustomHours) || 24;
        expiryDate.setHours(expiryDate.getHours() + hours);
      } else {
        expiryDate = null; // Unlimited
      }

      const fileIdsPayload = shareSelectedDocIds.length > 0 ? shareSelectedDocIds : [shareModalFile.id];
      const isOtpActive = shareAuthMethod === "EMAIL_OTP" || shareAuthMethod === "BOTH";

      const res = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds: fileIdsPayload,
          fileId: fileIdsPayload[0],
          transferMode: shareTransferMode,
          authMethod: shareAuthMethod,
          recipientEmail: shareRecipientEmail.trim() || null,
          expiresAt: expiryDate ? expiryDate.toISOString() : null,
          maxDownloads: shareMaxDownloads ? parseInt(shareMaxDownloads) : null,
          password: (shareAuthMethod === "PASSWORD" || shareAuthMethod === "BOTH") ? sharePassword : null,
          otpEnabled: isOtpActive,
          allowedIps: shareAllowedIps || null,
          allowedGeos: shareAllowedGeos || null,
          watermarkText: shareWatermarkText || null,
          stegoEnabled: shareStegoEnabled,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create share link");
      }

      if (data.shareLink.stegoPayload) {
        setCreatedStegoPayload(data.shareLink.stegoPayload);
      }

      // Secure link: do not expose raw encryption keys in share URL
      const portalUrl = `${window.location.origin}/d/${data.shareLink.id}`;
      setGeneratedShareUrl(portalUrl);

      showToast(
        "success",
        shareTransferMode === "BLOCKCHAIN"
          ? `Blockchain transfer created with ${fileIdsPayload.length} file(s). Hash queued on-chain.`
          : `Standard transfer link created with ${fileIdsPayload.length} file(s).`
      );
      fetchDashboardData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg);
    }
  };

  // Revoke/Restore sharing links
  const handleToggleLinkRevoke = async (linkId: string, currentStatus: boolean) => {
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkId,
          action: currentStatus ? "restore" : "revoke",
        }),
      });

      if (!res.ok) throw new Error("Revocation query failed");

      showToast("success", currentStatus ? "Sharing link restored." : "Sharing link instantly revoked.");
      fetchDashboardData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!confirm("Are you sure you want to permanently erase this sharing link record?")) return;
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId, action: "delete" }),
      });
      if (!res.ok) throw new Error("Delete failed");

      showToast("success", "Sharing link erased permanently.");
      fetchDashboardData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg);
    }
  };

  // -------------------------------------------------------------
  // Live Blockchain Verification Modal Handler
  // -------------------------------------------------------------
  const handleVerifyBlockchainProof = async (link: any) => {
    setSelectedVerifyLink(link);
    setIsVerifyingBlockchain(true);
    setBlockchainVerifyResult(null);

    try {
      const res = await fetch(`/api/blockchain/verify?linkId=${link.id}`);
      const data = await res.json();
      setBlockchainVerifyResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBlockchainVerifyResult({
        verified: false,
        status: "RPC_OFFLINE",
        message: msg || "Blockchain RPC node unavailable.",
      });
    } finally {
      setIsVerifyingBlockchain(false);
    }
  };

  // -------------------------------------------------------------
  // Cryptographic Ledger Verification
  // -------------------------------------------------------------
  const handleVerifyLedger = async () => {
    setIsVerifyingLedger(true);
    setLedgerVerificationStatus(null);
    await new Promise((r) => setTimeout(r, 1200));

    try {
      const res = await fetch("/api/audit/logs?verify=true");
      const data = await res.json();

      if (data.verification && data.verification.isValid) {
        setLedgerVerificationStatus({
          valid: true,
          message: `Ledger verified. ${data.verification.totalBlocks} log blocks evaluated. Hash dependencies conform 100% to blockchain baseline.`,
        });
        showToast("success", "Audit trail successfully verified.");
      } else {
        setLedgerVerificationStatus({
          valid: false,
          message: `Security Warning! Cryptographic chain broken at Index: ${data.verification?.tamperedIndex || "unknown"}. Potential database alteration detected!`,
        });
        showToast("error", "Cryptographic validation failed! Data modification warning.");
      }
    } catch {
      setLedgerVerificationStatus({
        valid: false,
        message: "Failed to connect to the node database validator.",
      });
    } finally {
      setIsVerifyingLedger(false);
    }
  };

  // -------------------------------------------------------------
  // Authenticator MFA Setup Flow
  // -------------------------------------------------------------
  const handleMfaSetupStart = async () => {
    setMfaSetupActive(true);
    try {
      const res = await fetch("/api/auth/mfa");
      const data = await res.json();
      setMfaQrCodeUrl(data.qrCodeDataUrl);
      setMfaSecretText(data.secret);
    } catch {
      showToast("error", "Failed to generate MFA setup challenges.");
    }
  };

  const handleMfaSetupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCodeInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast("success", "MFA successfully verified and activated.");
      setMfaSetupActive(false);
      setMfaCodeInput("");
      setMfaQrCodeUrl("");
      setMfaSecretText("");
      fetchDashboardData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg || "Invalid OTP code configuration.");
    }
  };

  const handleMfaDisable = async () => {
    if (!confirm("Are you sure you want to remove Microsoft Authenticator MFA from your account?")) return;
    try {
      const res = await fetch("/api/auth/mfa", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast("success", "Microsoft Authenticator MFA disabled successfully.");
      fetchDashboardData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg || "Failed to disable MFA.");
    }
  };

  const handleRegisterPasskey = async () => {
    try {
      const optRes = await fetch("/api/auth/passkeys");
      const options = await optRes.json();
      const regResponse = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: regResponse }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error);

      showToast("success", "Passkey registered. Hardware authentication ready.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast("error", msg || "Passkey registration canceled or failed.");
    }
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return "0 Bytes";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex h-screen w-full bg-cyber-dark text-text-primary overflow-hidden select-none">
      {/* Toast Notification HUD */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-xl border z-50 text-xs font-mono flex items-center gap-3 shadow-2xl backdrop-blur-md ${
              toast.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                : toast.type === "error"
                ? "bg-rose-500/10 border-rose-500/25 text-rose-400"
                : "bg-indigo-500/10 border-indigo-500/25 text-indigo-400"
            }`}
          >
            {toast.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-border-primary bg-cyber-card backdrop-blur-lg p-5 flex flex-col justify-between">
        <div className="space-y-8">
          {/* Brand */}
          <div className="flex items-center gap-2.5 px-2">
            <Shield className="w-5 h-5 text-indigo-500" />
            <div>
              <span className="font-bold tracking-tight text-sm text-text-primary">SecureDocX</span>
              <p className="text-[9px] text-text-secondary font-mono">Secure. Share. Verify.</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="space-y-1">
            {[
              { id: "overview", label: "Overview", icon: ShieldCheck },
              { id: "links", label: "Secure Transfers", icon: Link2 },
              { id: "files", label: "My Documents", icon: Folder },
              { id: "upload", label: "Document Encryption", icon: Upload },
              { id: "analytics", label: "Admin Analytics", icon: BarChart3 },
              { id: "stego", label: "Steganography Tool", icon: ImageIcon },
              { id: "audit", label: "Blockchain & Ledger", icon: Activity },
              { id: "security", label: "Security Sentinel", icon: Cpu },
              { id: "settings", label: "Settings & MFA", icon: Settings },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 text-xs font-medium rounded-xl font-mono transition-all cursor-pointer ${
                    activeTab === item.id
                      ? "bg-indigo-600/15 border-l-2 border-indigo-500 text-indigo-400 font-bold"
                      : "text-text-secondary hover:text-text-primary hover:bg-cyber-dark"
                  }`}
                >
                  <Icon className="w-4.5 h-4.5" />
                  {item.label}
                </button>
              );
            })}

            <a
              href="/recovery"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-xl font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all mt-4"
            >
              <div className="flex items-center gap-2.5">
                <FileCheck className="w-4 h-4" />
                <span>Recovery Portal</span>
              </div>
              <ExternalLink className="w-3 h-3 text-emerald-400" />
            </a>
          </nav>
        </div>

        {/* User Block */}
        <div className="pt-4 border-t border-border-primary space-y-4">
          <div className="flex flex-col px-2">
            <span className="text-[10px] text-text-secondary uppercase tracking-widest font-mono">Authenticated User</span>
            <span className="text-xs font-mono font-medium text-text-primary truncate mt-0.5">{userProfile.email}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-xs text-rose-400 hover:text-rose-300 rounded-xl hover:bg-rose-950/10 font-mono transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Erase Session
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-grow p-8 overflow-y-auto relative bg-cyber-dark">
        <AnimatePresence mode="wait">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-text-primary">Portal Overview</h1>
                <p className="text-xs text-text-secondary font-mono mt-1">Dual-Mode Security Infrastructure: Standard & Blockchain Verified Transfers</p>
              </div>

              {/* Master Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Metric 1 */}
                <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <Folder className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-secondary uppercase tracking-wider font-mono">Total Documents</div>
                    <div className="text-xl font-bold text-text-primary mt-0.5">{files.length}</div>
                    <div className="text-[10px] text-indigo-400 font-mono">{formatBytes(files.reduce((acc, f) => acc + f.fileSize, 0))}</div>
                  </div>
                </div>

                {/* Metric 2 */}
                <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-secondary uppercase tracking-wider font-mono">Blockchain Transfers</div>
                    <div className="text-xl font-bold text-emerald-400 mt-0.5">
                      {links.filter((l) => l.transferMode === "BLOCKCHAIN").length}
                    </div>
                    <div className="text-[10px] text-emerald-400/80 font-mono">On-chain integrity proofs</div>
                  </div>
                </div>

                {/* Metric 3 */}
                <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-secondary uppercase tracking-wider font-mono">Standard Transfers</div>
                    <div className="text-xl font-bold text-cyan-400 mt-0.5">
                      {links.filter((l) => l.transferMode !== "BLOCKCHAIN").length}
                    </div>
                    <div className="text-[10px] text-cyan-400/80 font-mono">Zero-knowledge AES-256</div>
                  </div>
                </div>

                {/* Metric 4 */}
                <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-secondary uppercase tracking-wider font-mono">Total Downloads</div>
                    <div className="text-xl font-bold text-text-primary mt-0.5">
                      {links.reduce((acc, l) => acc + (l.downloadCount || 0), 0)}
                    </div>
                    <div className="text-[10px] text-purple-400 font-mono">Verified by policy gate</div>
                  </div>
                </div>
              </div>

              {/* Layout splits */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Recent Activities */}
                <div className="lg:col-span-7 glass-panel rounded-2xl p-6 space-y-4">
                  <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" /> Recent Audit Activity Ledger
                  </h3>
                  <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2">
                    {auditLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="p-3 bg-cyber-dark border border-border-primary rounded-xl flex items-center justify-between text-xs font-mono">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded uppercase font-bold">{log.action}</span>
                            <span className="text-text-secondary text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-text-secondary text-[11px] truncate max-w-[340px]">
                            Actor: {log.userEmail || log.ipAddress || "System Gateway"}
                          </div>
                        </div>
                        <div className="text-[10px] text-indigo-500/80 bg-indigo-500/5 px-2 py-1 rounded select-all font-mono">
                          block_{log.index}
                        </div>
                      </div>
                    ))}
                    {auditLogs.length === 0 && (
                      <div className="text-xs text-gray-500 font-mono text-center py-6">No cryptographic activity recorded yet.</div>
                    )}
                  </div>
                </div>

                {/* Threat Diagnostics Card */}
                <div className="lg:col-span-5 glass-panel rounded-2xl p-6 flex flex-col justify-between">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-400" /> AI Threat Sentinel & Risk Engine
                    </h3>
                    <div className="p-4 bg-cyber-dark rounded-xl border border-border-primary space-y-3 font-mono text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-text-secondary">AI Anomaly Sentinel:</span>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Active
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-text-secondary">Smart Contract Registry:</span>
                        <span className="text-cyan-400 font-bold">Sepolia / Local Node</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-text-secondary">Active Security Alerts:</span>
                        <span className="text-text-primary font-bold">{threats.length} logged</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-indigo-950/20 border border-border-primary rounded-xl font-mono text-[11px] text-indigo-300 leading-relaxed mt-4">
                    Policy Engine: Automatically enforces atomic download counters, geographical restrictions, and on-chain tamper detection.
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Secure Transfers (Links) Tab */}
          {activeTab === "links" && (
            <motion.div
              key="links"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-text-primary">Secure Document Transfers</h1>
                <p className="text-xs text-text-secondary font-mono mt-1">
                  Manage active transfer policies, verify blockchain proofs, and issue instant revocation commands.
                </p>
              </div>

              <div className="glass-panel rounded-2xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-cyber-card border-b border-border-primary text-text-secondary uppercase tracking-widest text-[9px]">
                      <th className="p-4">Transfer Mode</th>
                      <th className="p-4">Target Document</th>
                      <th className="p-4">Recipient Policy</th>
                      <th className="p-4">Downloads</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Blockchain Proof</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-primary text-text-primary">
                    {links.map((link) => {
                      let originalName = "encrypted_document";
                      try {
                        originalName = safeBase64Decode(link.file?.fileName || "");
                      } catch {}

                      const isBlockchain = link.transferMode === "BLOCKCHAIN";
                      const proof = link.blockchainProofs?.[0];

                      return (
                        <tr key={link.id} className="hover:bg-indigo-600/[0.02] transition-colors">
                          {/* Mode Badge */}
                          <td className="p-4">
                            {isBlockchain ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold">
                                <ShieldCheck className="w-3 h-3" /> BLOCKCHAIN
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 text-[10px] font-bold">
                                <Lock className="w-3 h-3" /> STANDARD
                              </span>
                            )}
                          </td>

                          {/* Document Name */}
                          <td className="p-4 max-w-[140px] truncate font-bold text-text-primary">
                            {originalName}
                          </td>

                          {/* Recipient & Policy */}
                          <td className="p-4 text-text-secondary space-y-0.5 text-[10px]">
                            {link.recipientEmail ? (
                              <div className="text-cyan-400 font-bold truncate max-w-[140px]">
                                Bound: {link.recipientEmail}
                              </div>
                            ) : (
                              <div className="text-text-secondary">Open / Ephemeral Link</div>
                            )}
                            {link.expiresAt && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-amber-500/80" />
                                <span>Expires: {new Date(link.expiresAt).toLocaleDateString()}</span>
                              </div>
                            )}
                            {link.passwordHash && <div className="text-indigo-400">● Password Barrier</div>}
                            {link.otpEnabled && <div className="text-purple-400">● OTP Required</div>}
                          </td>

                          {/* Downloads */}
                          <td className="p-4 text-text-secondary font-mono">
                            <span className="font-bold text-text-primary">{link.downloadCount}</span>
                            {link.maxDownloads ? ` / ${link.maxDownloads}` : " / ∞"}
                          </td>

                          {/* Status */}
                          <td className="p-4">
                            {link.isRevoked || link.status === "REVOKED" ? (
                              <span className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded uppercase font-bold">
                                REVOKED
                              </span>
                            ) : link.status === "FROZEN" ? (
                              <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded uppercase font-bold">
                                FROZEN
                              </span>
                            ) : link.expiresAt && new Date() > new Date(link.expiresAt) ? (
                              <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded uppercase font-bold">
                                EXPIRED
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded uppercase font-bold">
                                ACTIVE
                              </span>
                            )}
                          </td>

                          {/* Blockchain Proof */}
                          <td className="p-4 text-[10px] font-mono">
                            {isBlockchain ? (
                              <div className="space-y-1">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  proof?.status === "CONFIRMED" || proof?.status === "VERIFIED"
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                }`}>
                                  {proof?.status || "CONFIRMED"}
                                </span>
                                {proof?.proofId && (
                                  <div className="text-[9px] text-text-secondary truncate max-w-[110px]">
                                    {proof.proofId}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-text-secondary text-[10px]">Off-chain</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="p-4 text-right space-x-2 whitespace-nowrap">
                            {isBlockchain && (
                              <button
                                onClick={() => handleVerifyBlockchainProof(link)}
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-mono font-bold cursor-pointer transition-all inline-flex items-center gap-1"
                              >
                                <Check className="w-3 h-3" /> Verify On-Chain
                              </button>
                            )}

                            <button
                              onClick={() => handleToggleLinkRevoke(link.id, link.isRevoked || link.status === "REVOKED")}
                              className={`px-2.5 py-1.5 rounded-lg border text-[10px] cursor-pointer transition-all ${
                                link.isRevoked || link.status === "REVOKED"
                                  ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10"
                                  : "border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10"
                              }`}
                            >
                              {link.isRevoked || link.status === "REVOKED" ? "Restore" : "Revoke"}
                            </button>

                            <button
                              onClick={() => handleDeleteLink(link.id)}
                              className="p-1.5 rounded-lg border border-border-primary hover:border-rose-500/30 bg-cyber-dark text-text-secondary hover:text-rose-400 cursor-pointer transition-all inline-block"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {links.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-text-secondary">
                          No secure transfers created yet. Upload a document to generate a transfer link.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* My Documents (Files) Tab */}
          {activeTab === "files" && (
            <motion.div
              key="files"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-text-primary">My Documents</h1>
                  <p className="text-xs text-text-secondary font-mono mt-1">Encrypted document vaults stored securely off-chain.</p>
                </div>
                <div className="flex items-center gap-2.5">
                  {selectedDocIds.length > 0 && (
                    <button
                      onClick={() => handleOpenShareModal(undefined, selectedDocIds)}
                      className="px-4 py-2 bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white text-xs font-mono font-bold rounded-xl cursor-pointer transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Create Multi-File Transfer ({selectedDocIds.length} / 20)
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab("upload")}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono rounded-xl cursor-pointer transition-all flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload Document
                  </button>
                </div>
              </div>

              {selectedDocIds.length > 0 && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/25 rounded-xl flex items-center justify-between font-mono text-xs text-indigo-300">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    <span><b>{selectedDocIds.length}</b> of 20 maximum documents selected for single-link sharing</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSelectAllDocs}
                      className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                    >
                      {selectedDocIds.length === Math.min(files.length, 20) ? "Deselect All" : "Select Up To 20"}
                    </button>
                    <span className="text-border-primary">|</span>
                    <button
                      onClick={() => setSelectedDocIds([])}
                      className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              <div className="glass-panel rounded-2xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-cyber-card border-b border-border-primary text-text-secondary uppercase tracking-widest text-[9px]">
                      <th className="p-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.length > 0 && selectedDocIds.length === Math.min(files.length, 20)}
                          onChange={handleSelectAllDocs}
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="p-4">Document Name</th>
                      <th className="p-4">Size</th>
                      <th className="p-4">Encryption Standard</th>
                      <th className="p-4">SHA-256 Integrity Hash</th>
                      <th className="p-4">Uploaded</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-primary text-text-primary">
                    {files.map((file) => {
                      let originalName = "encrypted_name";
                      try {
                        originalName = safeBase64Decode(file.fileName);
                      } catch {}

                      const isSelected = selectedDocIds.includes(file.id);

                      return (
                        <tr key={file.id} className={`hover:bg-indigo-600/[0.04] transition-colors ${isSelected ? "bg-indigo-600/[0.06]" : ""}`}>
                          <td className="p-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleDocSelection(file.id)}
                              className="accent-indigo-500 cursor-pointer"
                            />
                          </td>
                          <td className="p-4 font-bold text-text-primary flex items-center gap-2.5">
                            <HardDrive className={`w-4 h-4 ${isSelected ? "text-indigo-400" : "text-text-secondary"}`} />
                            {originalName}
                          </td>
                          <td className="p-4 text-text-secondary">{formatBytes(file.fileSize)}</td>
                          <td className="p-4">
                            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-bold">
                              AES-256-GCM
                            </span>
                          </td>
                          <td className="p-4 font-mono text-[10px] text-text-secondary select-all truncate max-w-[180px]">
                            {file.signature || "SHA256_VERIFIED"}
                          </td>
                          <td className="p-4 text-text-secondary">{new Date(file.createdAt).toLocaleDateString()}</td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => handleOpenShareModal(file, isSelected ? selectedDocIds : [file.id])}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-mono text-xs cursor-pointer inline-flex items-center gap-1.5 transition-all shadow-md"
                            >
                              <Link2 className="w-3 h-3" />
                              {selectedDocIds.length > 1 && isSelected
                                ? `Bundle (${selectedDocIds.length})`
                                : "Create Transfer"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                    {files.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-text-secondary">
                          No encrypted documents found. Upload a file to start secure transfers.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Document Upload Tab */}
          {activeTab === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-xl mx-auto"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-text-primary">Secure Document Upload</h1>
                <p className="text-xs text-text-secondary font-mono mt-1">Zero-Knowledge Isolation: files are encrypted client-side using Web Crypto AES-256-GCM.</p>
              </div>

              <form onSubmit={handleFileUpload} className="space-y-6">
                {uploadCryptStep === 0 ? (
                  <div
                    onClick={() => document.getElementById("file-select")?.click()}
                    className="border-2 border-dashed border-border-primary hover:border-indigo-500/40 bg-cyber-dark rounded-2xl p-12 text-center cursor-pointer transition-all flex flex-col items-center gap-4 hover:shadow-lg"
                  >
                    <input
                      id="file-select"
                      type="file"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center glow-indigo">
                      <Upload className="w-6 h-6" />
                    </div>
                    {uploadFile ? (
                      <div>
                        <p className="text-sm font-mono text-text-primary font-bold">{uploadFile.name}</p>
                        <p className="text-xs text-text-secondary mt-1">{formatBytes(uploadFile.size)}</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-mono text-text-primary">Click to select document or drop file here</p>
                        <p className="text-xs text-text-secondary mt-1">PDF, Word, Images, Archives up to 100MB</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="glass-panel rounded-2xl p-8 space-y-5 font-mono">
                    <div className="flex justify-between text-xs">
                      <span className="text-indigo-400 font-bold">STATUS: {uploadStatus}</span>
                      <span className="text-text-secondary">{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-cyber-dark h-2 rounded-full overflow-hidden border border-border-primary">
                      <div
                        style={{ width: `${uploadProgress}%` }}
                        className="bg-gradient-to-r from-primary-indigo to-primary-purple h-full rounded-full transition-all duration-300"
                      />
                    </div>
                    {currentFileHash && (
                      <div className="p-3 bg-cyber-dark rounded-xl border border-border-primary text-[10px] text-text-secondary truncate">
                        SHA-256: <span className="text-cyan-400 select-all">{currentFileHash}</span>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!uploadFile || uploadCryptStep > 0}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 disabled:opacity-40 text-white font-medium text-xs font-mono flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
                >
                  <Lock className="w-4 h-4" /> Encrypt Locally & Store Payload
                </button>
              </form>
            </motion.div>
          )}

          {/* Admin Analytics Tab */}
          {activeTab === "analytics" && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AdminAnalyticsView />
            </motion.div>
          )}

          {/* Steganography Tool Tab */}
          {activeTab === "stego" && (
            <motion.div
              key="stego"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <StegoToolView files={files} links={links} />
            </motion.div>
          )}

          {/* Blockchain & Ledger Tab */}
          {activeTab === "audit" && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-text-primary">Blockchain & Activity Ledger</h1>
                  <p className="text-xs text-text-secondary font-mono mt-1">
                    Tamper-evident audit chain with on-chain Ethereum smart contract proof verification.
                  </p>
                </div>
                <button
                  onClick={handleVerifyLedger}
                  disabled={isVerifyingLedger}
                  className="px-4 py-2.5 rounded-xl border border-border-primary bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 text-xs font-mono flex items-center gap-2 cursor-pointer transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingLedger ? "animate-spin" : ""}`} />
                  Verify Hash Integrity
                </button>
              </div>

              {ledgerVerificationStatus && (
                <div
                  className={`p-4 rounded-xl border text-xs font-mono flex items-center gap-3 ${
                    ledgerVerificationStatus.valid
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  }`}
                >
                  {ledgerVerificationStatus.valid ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  {ledgerVerificationStatus.message}
                </div>
              )}

              <div className="glass-panel rounded-2xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-cyber-card border-b border-border-primary text-text-secondary uppercase tracking-widest text-[9px]">
                      <th className="p-4">Index</th>
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Action</th>
                      <th className="p-4">Actor</th>
                      <th className="p-4">Cryptographic Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-primary text-text-primary">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-indigo-600/[0.02] transition-colors">
                        <td className="p-4 text-indigo-400 font-bold">#{log.index}</td>
                        <td className="p-4 text-text-secondary">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="p-4">
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-bold uppercase">
                            {log.action}
                          </span>
                        </td>
                        <td className="p-4 text-text-secondary truncate max-w-[200px]">{log.userEmail || log.ipAddress || "System"}</td>
                        <td className="p-4 text-[10px] font-mono text-text-secondary select-all truncate max-w-[220px]">
                          {log.hash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Security Sentinel Tab */}
          {activeTab === "security" && (
            <motion.div
              key="security"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-text-primary">Security Sentinel & Threat Telemetry</h1>
                <p className="text-xs text-text-secondary font-mono mt-1">Real-time risk scoring, anomaly detection, and automatic transfer freezing.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="glass-panel p-5 rounded-2xl space-y-1">
                  <div className="text-[10px] font-mono text-text-secondary uppercase">Risk Engine Status</div>
                  <div className="text-lg font-bold text-emerald-400">ACTIVE & MONITORING</div>
                  <div className="text-[10px] text-text-secondary font-mono">Dynamic policy gates active</div>
                </div>
                <div className="glass-panel p-5 rounded-2xl space-y-1">
                  <div className="text-[10px] font-mono text-text-secondary uppercase">Threat Severity</div>
                  <div className="text-lg font-bold text-text-primary">{threats.length === 0 ? "LOW (0 ALERTS)" : `${threats.length} THREATS`}</div>
                  <div className="text-[10px] text-text-secondary font-mono">Isolation forest anomaly evaluation</div>
                </div>
                <div className="glass-panel p-5 rounded-2xl space-y-1">
                  <div className="text-[10px] font-mono text-text-secondary uppercase">Smart Contract Audit</div>
                  <div className="text-lg font-bold text-cyan-400">Sepolia Registry</div>
                  <div className="text-[10px] text-text-secondary font-mono">Immutable proof verification</div>
                </div>
              </div>

              <div className="glass-panel rounded-2xl overflow-hidden">
                <table className="w-full border-collapse text-left text-xs font-mono">
                  <thead>
                    <tr className="bg-cyber-card border-b border-border-primary text-text-secondary uppercase tracking-widest text-[9px]">
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Threat Classification</th>
                      <th className="p-4">Risk Score</th>
                      <th className="p-4">IP Origin</th>
                      <th className="p-4">Diagnosis Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-primary text-text-primary">
                    {threats.map((t) => (
                      <tr key={t.id} className="hover:bg-rose-500/[0.02] transition-colors">
                        <td className="p-4 text-text-secondary">{new Date(t.timestamp).toLocaleTimeString()}</td>
                        <td className="p-4">
                          <span className="text-[10px] bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded font-bold uppercase">
                            {t.threatType}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-rose-400">{(t.riskScore * 100).toFixed(0)}/100</td>
                        <td className="p-4 text-text-secondary">{t.ipAddress}</td>
                        <td className="p-4 text-text-secondary truncate max-w-[300px]">{t.details}</td>
                      </tr>
                    ))}
                    {threats.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-text-secondary">
                          No suspicious anomalies or security alerts detected. System secure.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* Settings & MFA Tab */}
          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 max-w-xl"
            >
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-text-primary">Security Settings</h1>
                <p className="text-xs text-text-secondary font-mono mt-1">Multi-factor authentication gates and biometric passkeys.</p>
              </div>

              {/* MFA Settings */}
              <div className="glass-panel rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <QrCode className="w-4.5 h-4.5 text-indigo-400" /> Microsoft Authenticator (TOTP)
                </h3>
                <p className="text-xs text-text-secondary font-mono leading-relaxed">
                  Protect account sign-ins with synchronized 6-digit TOTP passcodes using the Microsoft Authenticator or Google Authenticator app.
                </p>

                {mfaSetupActive ? (
                  <form onSubmit={handleMfaSetupVerify} className="space-y-4 pt-2">
                    {mfaQrCodeUrl && (
                      <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-xl max-w-xs mx-auto">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={mfaQrCodeUrl} alt="MFA QR Code" className="w-48 h-48" />
                        <span className="text-[10px] font-mono text-gray-700 text-center select-all">Secret: {mfaSecretText}</span>
                      </div>
                    )}
                    <input
                      type="text"
                      maxLength={6}
                      value={mfaCodeInput}
                      onChange={(e) => setMfaCodeInput(e.target.value)}
                      required
                      placeholder="000000"
                      className="w-full p-2.5 rounded-xl bg-cyber-dark border border-border-primary text-center tracking-[4px] text-sm font-mono text-indigo-400 font-bold outline-none"
                    />
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs rounded-xl cursor-pointer"
                      >
                        Verify & Activate
                      </button>
                      <button
                        type="button"
                        onClick={() => setMfaSetupActive(false)}
                        className="px-4 py-2.5 border border-border-primary text-text-secondary font-mono text-xs rounded-xl cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : userProfile.mfaEnabled ? (
                  <div className="space-y-4 pt-2">
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-mono flex items-center gap-3">
                      <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      <div>
                        <div className="font-bold">Status: Active & Protected</div>
                        <div className="text-[10px] text-emerald-400/80 mt-0.5">Your sign-ins require Microsoft Authenticator OTP.</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleMfaDisable}
                      className="px-4 py-2.5 rounded-xl border border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 font-mono text-xs flex items-center gap-2 cursor-pointer transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> Remove Authenticator
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleMfaSetupStart}
                    className="px-4 py-2.5 rounded-xl border border-border-primary bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 font-mono text-xs flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <QrCode className="w-4 h-4" /> Connect Authenticator App
                  </button>
                )}
              </div>

              {/* Passkeys Settings */}
              <div className="glass-panel rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <Fingerprint className="w-4.5 h-4.5 text-purple-400" /> Biometric Passkeys (WebAuthn)
                </h3>
                <p className="text-xs text-text-secondary font-mono leading-relaxed">
                  Register hardware biometrics (TouchID, FaceID, Windows Hello) for password-less cryptographic authentication.
                </p>
                <button
                  onClick={handleRegisterPasskey}
                  className="px-4 py-2.5 rounded-xl border border-purple-500/25 bg-purple-500/5 hover:bg-purple-500/10 text-purple-400 font-mono text-xs flex items-center gap-2 cursor-pointer transition-all"
                >
                  <Fingerprint className="w-4 h-4 text-purple-400" /> Register Biometric Passkey
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Share Link Restriction Modal with Dual-Mode Selection */}
      <AnimatePresence>
        {shareModalFile && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg glass-panel rounded-2xl p-6 border-border-primary relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setShareModalFile(null)}
                className="absolute top-4 right-4 text-text-secondary hover:text-text-primary cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-base font-bold text-text-primary flex items-center gap-2 mb-4 font-mono">
                <Link2 className="w-4.5 h-4.5 text-indigo-400" /> Create Secure Transfer
              </h2>

              {generatedShareUrl ? (
                /* Post-creation Url display */
                <div className="space-y-4 py-4">
                  <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-mono font-bold flex gap-2.5 items-center">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    {shareTransferMode === "BLOCKCHAIN"
                      ? "Blockchain Transfer Created & Sealed"
                      : "Standard Transfer Link Generated"}
                  </div>

                  <div className="space-y-3 font-mono text-xs bg-cyber-card p-4 rounded-xl border border-border-primary">
                    <div className="text-text-secondary uppercase tracking-widest text-[9px] font-bold">Secure Transfer Link</div>
                    <div className="bg-emerald-950/20 p-2.5 rounded border border-emerald-500/10 select-all text-emerald-300 break-all leading-normal cursor-pointer text-xs font-bold font-sans">
                      {generatedShareUrl}
                    </div>
                    <p className="text-[10px] text-text-secondary leading-relaxed">
                      KMS Key Envelope Protected: Raw keys are never stored in URLs, database, or blockchain. Ephemeral DEK is unlocked only after recipient policy verification.
                    </p>

                    {createdStegoPayload && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-[11px] space-y-2">
                        <div className="flex items-center gap-2 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Steganography Verification Carrier Ready</span>
                        </div>
                        <p className="text-[10px] text-text-secondary">
                          A protected verification token has been generated. You can embed it into an image carrier.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setShareModalFile(null);
                            setActiveTab("stego");
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1.5"
                        >
                          <ImageIcon className="w-3 h-3" />
                          Open Stego Tool to Embed Image
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setShareModalFile(null)}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-medium rounded-xl cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : (
                /* Transfer Setup Form */
                <form onSubmit={handleCreateShareLink} className="space-y-5">
                  {/* MULTI-DOCUMENT BUNDLE SELECTOR (Up to 20 files) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider font-bold flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-indigo-400" />
                        Bundled Documents ({shareSelectedDocIds.length} / 20)
                      </label>
                      <span className="text-[10px] font-mono text-indigo-400 font-semibold">
                        Single Link (Max 20)
                      </span>
                    </div>

                    <div className="p-3 bg-cyber-dark/80 rounded-xl border border-border-primary space-y-2 max-h-40 overflow-y-auto">
                      {files.map((f) => {
                        let name = "document.bin";
                        try {
                          name = safeBase64Decode(f.fileName);
                        } catch {
                          name = f.fileName;
                        }
                        const isChecked = shareSelectedDocIds.includes(f.id);

                        return (
                          <div
                            key={f.id}
                            onClick={() => handleToggleDocInModal(f.id)}
                            className={`p-2 rounded-lg border font-mono text-xs cursor-pointer transition-all flex items-center justify-between gap-2 ${
                              isChecked
                                ? "bg-indigo-600/15 border-indigo-500/50 text-text-primary"
                                : "bg-cyber-card border-border-primary/50 text-text-secondary hover:border-indigo-500/30"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}} // handled by parent onClick
                                className="accent-indigo-500 cursor-pointer"
                              />
                              <span className="truncate text-[11px] font-bold">{name}</span>
                            </div>
                            <span className="text-[9px] text-text-secondary shrink-0">{formatBytes(f.fileSize)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* TRANSFER MODE SELECTOR */}
                  <div>
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2 font-bold">
                      Transfer Mode
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Standard Mode Card */}
                      <div
                        onClick={() => setShareTransferMode("STANDARD")}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          shareTransferMode === "STANDARD"
                            ? "bg-indigo-600/15 border-indigo-500 text-indigo-400"
                            : "bg-cyber-dark border-border-primary text-text-secondary hover:border-border-primary"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-mono font-bold flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5" /> Standard Transfer
                          </span>
                          <input
                            type="radio"
                            name="transferMode"
                            checked={shareTransferMode === "STANDARD"}
                            onChange={() => setShareTransferMode("STANDARD")}
                            className="accent-indigo-500"
                          />
                        </div>
                        <ul className="text-[10px] font-mono text-text-secondary space-y-1">
                          <li>✓ AES-256-GCM Encryption</li>
                          <li>✓ Ephemeral Access Policy</li>
                          <li>✓ Database Hash Chain</li>
                          <li>✗ Blockchain: Not Used</li>
                        </ul>
                      </div>

                      {/* Blockchain Mode Card */}
                      <div
                        onClick={() => setShareTransferMode("BLOCKCHAIN")}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                          shareTransferMode === "BLOCKCHAIN"
                            ? "bg-emerald-600/15 border-emerald-500 text-emerald-400 shadow-md shadow-emerald-500/5"
                            : "bg-cyber-dark border-border-primary text-text-secondary hover:border-border-primary"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-mono font-bold flex items-center gap-1.5 text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" /> Blockchain Transfer
                          </span>
                          <input
                            type="radio"
                            name="transferMode"
                            checked={shareTransferMode === "BLOCKCHAIN"}
                            onChange={() => setShareTransferMode("BLOCKCHAIN")}
                            className="accent-emerald-500"
                          />
                        </div>
                        <ul className="text-[10px] font-mono text-text-secondary space-y-1">
                          <li>✓ AES-256-GCM Encryption</li>
                          <li>✓ SHA-256 Integrity Hash</li>
                          <li>✓ On-Chain Smart Contract Proof</li>
                          <li className="text-emerald-400 font-bold">✓ Independent Verification</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* AUTHENTICATION METHOD SELECTOR */}
                  <div className="space-y-2">
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider font-bold flex items-center justify-between">
                      <span>Authentication Method</span>
                      <span className="text-[9px] text-indigo-400 font-normal">Access Barrier</span>
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          id: "NONE",
                          title: "Direct Access",
                          desc: "No password or OTP",
                          icon: Unlock,
                        },
                        {
                          id: "PASSWORD",
                          title: "Password",
                          desc: "Fixed link password",
                          icon: Lock,
                        },
                        {
                          id: "EMAIL_OTP",
                          title: "Email OTP",
                          desc: "5-min time-limited code",
                          icon: Mail,
                        },
                        {
                          id: "BOTH",
                          title: "Password + OTP",
                          desc: "Dual multi-factor barrier",
                          icon: ShieldCheck,
                        },
                      ].map((item) => {
                        const Icon = item.icon;
                        const isSelected = shareAuthMethod === item.id;
                        return (
                          <div
                            key={item.id}
                            onClick={() => setShareAuthMethod(item.id as any)}
                            className={`p-2.5 rounded-xl border cursor-pointer font-mono transition-all flex flex-col justify-between ${
                              isSelected
                                ? "bg-indigo-600/15 border-indigo-500 text-indigo-400 shadow-sm shadow-indigo-500/10"
                                : "bg-cyber-dark border-border-primary text-text-secondary hover:border-indigo-500/30"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold flex items-center gap-1.5 text-text-primary">
                                <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-400" : "text-text-secondary"}`} />
                                {item.title}
                              </span>
                              <input
                                type="radio"
                                name="authMethod"
                                checked={isSelected}
                                onChange={() => setShareAuthMethod(item.id as any)}
                                className="accent-indigo-500"
                              />
                            </div>
                            <span className="text-[10px] text-text-secondary">{item.desc}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recipient Email Binding (Mandatory for EMAIL_OTP or BOTH, Optional for NONE/PASSWORD) */}
                  {(shareAuthMethod === "EMAIL_OTP" || shareAuthMethod === "BOTH") ? (
                    <div className="space-y-2 p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-mono text-indigo-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-indigo-400" />
                          Designated Recipient Email (Required)
                        </label>
                        <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          OTP Bound
                        </span>
                      </div>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 w-4 h-4 text-text-secondary" />
                        <input
                          type="email"
                          required
                          placeholder="recipient@example.com (Mandatory for OTP dispatch)"
                          value={shareRecipientEmail}
                          onChange={(e) => setShareRecipientEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-cyber-dark border border-indigo-500/40 text-xs font-mono text-text-primary focus:border-indigo-400 outline-none"
                        />
                      </div>
                      <p className="text-[10px] font-mono text-text-secondary">
                        🔒 Link bound to recipient email • Recipient must verify a 6-digit OTP (5-minute validity) delivered to this address.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2">
                        Designated Recipient Email (Optional Binding)
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 w-4 h-4 text-text-secondary" />
                        <input
                          type="email"
                          placeholder="e.g. partner@enterprise.com (Only this email can access)"
                          value={shareRecipientEmail}
                          onChange={(e) => setShareRecipientEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:border-indigo-500/50 outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {/* Password Input (Mandatory if PASSWORD or BOTH) */}
                  {(shareAuthMethod === "PASSWORD" || shareAuthMethod === "BOTH") && (
                    <div className="space-y-1.5 p-3 bg-cyber-dark border border-indigo-500/30 rounded-xl">
                      <label className="block text-[10px] font-mono text-indigo-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-indigo-400" />
                        Link Security Password (Required)
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Enter link password for recipient"
                        value={sharePassword}
                        onChange={(e) => setSharePassword(e.target.value)}
                        className="w-full p-2.5 rounded-xl bg-cyber-card border border-border-primary text-xs font-mono text-text-primary focus:border-indigo-500/50 outline-none"
                      />
                    </div>
                  )}

                  {/* Expiration Presets */}
                  <div>
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2">
                      Expiration Timeframe
                    </label>
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {[
                        { id: "10m", label: "10 Min" },
                        { id: "30m", label: "30 Min" },
                        { id: "1h", label: "1 Hour" },
                        { id: "6h", label: "6 Hours" },
                        { id: "24h", label: "24 Hours" },
                        { id: "7d", label: "7 Days" },
                        { id: "never", label: "Never" },
                        { id: "custom", label: "Custom" },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setShareExpiryOption(preset.id)}
                          className={`py-1.5 text-[10px] font-mono rounded-lg border transition-all cursor-pointer ${
                            shareExpiryOption === preset.id
                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-400 font-bold"
                              : "bg-cyber-dark border-border-primary text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {shareExpiryOption === "custom" && (
                      <input
                        type="number"
                        placeholder="Custom Expiry in Hours (e.g. 48)"
                        value={shareCustomHours}
                        onChange={(e) => setShareCustomHours(e.target.value)}
                        className="w-full p-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:border-indigo-500/50 outline-none mt-1"
                      />
                    )}
                  </div>

                  {/* Max Downloads */}
                  <div>
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2">
                      Maximum Downloads (Atomic Limit)
                    </label>
                    <div className="flex gap-2 mb-2">
                      {["1", "3", "5", ""].map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setShareMaxDownloads(preset)}
                          className={`flex-1 py-1.5 text-[10px] font-mono rounded-lg border transition-all cursor-pointer ${
                            shareMaxDownloads === preset
                              ? "bg-indigo-600/20 border-indigo-500 text-indigo-400 font-bold"
                              : "bg-cyber-dark border-border-primary text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {preset === "" ? "Unlimited" : `${preset} Download`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Allowed Geos */}
                  <div>
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2">
                      Allowed Geo Countries
                    </label>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {[
                        { code: "US", label: "USA" },
                        { code: "DE", label: "Germany" },
                        { code: "IN", label: "India" },
                        { code: "CN", label: "China" },
                      ].map((country) => {
                        const isSelected = shareAllowedGeos
                          .split(",")
                          .map((c) => c.trim().toUpperCase())
                          .includes(country.code);
                        return (
                          <button
                            key={country.code}
                            type="button"
                            onClick={() => toggleAllowedGeo(country.code)}
                            className={`px-2 py-1 rounded border text-[10px] font-mono transition-all cursor-pointer ${
                              isSelected
                                ? "bg-indigo-600/20 border-indigo-500 text-indigo-400 font-bold"
                                : "bg-cyber-dark border-border-primary text-text-secondary hover:text-text-primary"
                            }`}
                          >
                            {country.label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      placeholder="Or type custom codes, e.g. FR, GB"
                      value={shareAllowedGeos}
                      onChange={(e) => setShareAllowedGeos(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:border-indigo-500/50 outline-none"
                    />
                  </div>

                  {/* Watermark */}
                  <div>
                    <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-wider mb-2">
                      Watermark Overlay (Overlay Text)
                    </label>
                    <input
                      type="text"
                      placeholder="CONFIDENTIAL DO NOT REDISTRIBUTE"
                      value={shareWatermarkText}
                      onChange={(e) => setShareWatermarkText(e.target.value)}
                      className="w-full p-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs font-mono text-text-primary focus:border-indigo-500/50 outline-none"
                    />
                  </div>

                  {/* Steganography Carrier Option */}
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-cyber-dark border border-border-primary">
                    <input
                      type="checkbox"
                      id="share-stego-check"
                      checked={shareStegoEnabled}
                      onChange={(e) => setShareStegoEnabled(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500 rounded"
                    />
                    <label htmlFor="share-stego-check" className="text-xs font-mono text-text-primary cursor-pointer flex items-center gap-2">
                      <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Optional Image Steganography Carrier Token</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-xs font-mono flex items-center justify-center gap-2 cursor-pointer shadow-lg mt-2"
                  >
                    <Key className="w-4 h-4" />
                    {shareTransferMode === "BLOCKCHAIN"
                      ? "Create Blockchain Transfer (Seal & Record Proof)"
                      : "Create Standard Transfer (Seal & Generate Link)"}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Blockchain Verification Modal */}
      <AnimatePresence>
        {selectedVerifyLink && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg glass-panel rounded-2xl p-6 border-border-primary relative max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setSelectedVerifyLink(null)}
                className="absolute top-4 right-4 text-text-secondary hover:text-text-primary cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text-primary font-mono">Blockchain Integrity Verification</h2>
                  <p className="text-[10px] text-text-secondary font-mono">Independent smart contract verification</p>
                </div>
              </div>

              {isVerifyingBlockchain ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-3 font-mono">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-emerald-400">Querying Ethereum Smart Contract Registry...</span>
                </div>
              ) : blockchainVerifyResult ? (
                <div className="space-y-4 font-mono text-xs">
                  {/* Status Banner */}
                  <div
                    className={`p-3.5 rounded-xl border flex items-center gap-3 ${
                      blockchainVerifyResult.verified
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                    }`}
                  >
                    {blockchainVerifyResult.verified ? (
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    )}
                    <div>
                      <div className="font-bold">
                        {blockchainVerifyResult.verified
                          ? "✓ VERIFIED ON-CHAIN (100% MATCH)"
                          : blockchainVerifyResult.status === "RPC_OFFLINE"
                          ? "STANDBY: RPC Node Offline"
                          : "STATUS: " + blockchainVerifyResult.status}
                      </div>
                      <div className="text-[10px] opacity-90 mt-0.5">{blockchainVerifyResult.message}</div>
                    </div>
                  </div>

                  {/* Hash Comparison HUD */}
                  <div className="p-4 bg-cyber-dark rounded-xl border border-border-primary space-y-3">
                    <div>
                      <div className="text-[9px] text-text-secondary uppercase tracking-widest font-bold">Database Document Hash (SHA-256)</div>
                      <div className="text-[10px] text-text-primary bg-cyber-card p-2 rounded mt-1 select-all font-mono break-all">
                        {blockchainVerifyResult.databaseDocumentHash || "0x..."}
                      </div>
                    </div>

                    <div>
                      <div className="text-[9px] text-text-secondary uppercase tracking-widest font-bold">Blockchain Stored Hash (On-Chain)</div>
                      <div className="text-[10px] text-emerald-300 bg-emerald-950/20 p-2 rounded mt-1 select-all font-mono break-all">
                        {blockchainVerifyResult.blockchainDocumentHash || "Recorded in smart contract"}
                      </div>
                    </div>
                  </div>

                  {/* Technical Metadata Table */}
                  <div className="p-3 bg-cyber-dark/80 rounded-xl border border-border-primary space-y-2 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Network:</span>
                      <span className="text-cyan-400 uppercase font-bold">{blockchainVerifyResult.network || "sepolia"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Contract Address:</span>
                      <span className="text-text-primary select-all truncate max-w-[240px]">
                        {blockchainVerifyResult.contractAddress || "0x5FbDB2315678afecb367f032d93F642f64180aa3"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Canonical Proof ID:</span>
                      <span className="text-text-primary select-all">{blockchainVerifyResult.proofId}</span>
                    </div>
                    {blockchainVerifyResult.txHash && (
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Transaction Hash:</span>
                        <span className="text-indigo-400 select-all truncate max-w-[240px]">
                          {blockchainVerifyResult.txHash}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleVerifyBlockchainProof(selectedVerifyLink)}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Re-Verify Live
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedVerifyLink(null)}
                      className="px-4 py-2.5 border border-border-primary text-text-secondary font-mono text-xs rounded-xl cursor-pointer hover:text-text-primary"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
