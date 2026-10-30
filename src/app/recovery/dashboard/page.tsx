"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield, Key, Download, Lock, CheckCircle2, AlertTriangle,
  RefreshCw, ExternalLink, ArrowRight, FileCheck, Layers,
  ShieldCheck, Unlock, LogOut, Clock, HardDrive, Users, Sparkles,
  Search, ShieldAlert, Check
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface TransferItem {
  id: string;
  transferMode: string;
  senderEmail: string;
  status: string;
  authMethod: string;
  hasPassword: boolean;
  otpEnabled: boolean;
  downloadCount: number;
  maxDownloads: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  isRevoked: boolean;
  stegoEnabled: boolean;
  files: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: string;
  }>;
  fileCount: number;
}

function safeDecodeFileName(b64: string): string {
  try {
    return decodeURIComponent(escape(window.atob(b64)));
  } catch {
    try {
      return window.atob(b64);
    } catch {
      return b64 || "secure_document.bin";
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function RecipientDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [error, setError] = useState("");
  const [quickSearchId, setQuickSearchId] = useState("");

  const fetchTransfers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/recovery/my-transfers");
      if (res.status === 401) {
        router.push("/recovery/login");
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load transfers.");
      }

      setRecipientEmail(data.recipientEmail || "");
      setTransfers(data.transfers || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/recovery/login");
    } catch (err) {
      router.push("/");
    }
  };

  const handleQuickLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickSearchId.trim();
    if (!clean) return;
    let targetId = clean;
    if (clean.includes("/d/")) {
      targetId = clean.split("/d/")[1]?.split("?")[0] || clean;
    } else if (clean.includes("id=")) {
      try {
        const u = new URL(clean.startsWith("http") ? clean : `https://x.com/${clean}`);
        targetId = u.searchParams.get("id") || clean;
      } catch {
        targetId = clean;
      }
    }
    targetId = targetId.replace(/[^a-zA-Z0-9_\-]/g, "");
    router.push(`/recovery?id=${encodeURIComponent(targetId)}`);
  };

  const activeTransfersCount = transfers.filter((t) => t.status === "ACTIVE").length;

  return (
    <div className="min-h-screen bg-cyber-dark text-text-primary selection:bg-success-emerald selection:text-white flex flex-col">
      {/* Top Header */}
      <header className="border-b border-border-primary/80 bg-cyber-card/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-success-emerald to-accent-cyan flex items-center justify-center glow-emerald">
              <Unlock className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">FortressShare</span>
                <span className="px-2 py-0.5 rounded-full bg-success-emerald/15 border border-success-emerald/30 text-[10px] font-mono font-bold text-success-emerald uppercase">
                  Recipient Vault
                </span>
              </div>
              <span className="text-[11px] text-text-secondary font-mono">
                Zero-Knowledge Document Reconstitution
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {recipientEmail && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-dark border border-border-primary text-xs">
                <span className="w-2 h-2 rounded-full bg-success-emerald animate-pulse" />
                <span className="font-mono text-text-secondary">{recipientEmail}</span>
              </div>
            )}

            <Link
              href="/dashboard"
              className="px-3 py-1.5 rounded-lg border border-border-primary hover:border-primary-indigo text-xs text-text-secondary hover:text-white transition-all flex items-center gap-1.5"
            >
              <Shield className="w-3.5 h-3.5 text-primary-indigo" />
              <span className="hidden sm:inline">Sender Portal</span>
            </Link>

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg border border-border-primary hover:border-danger-rose/50 hover:bg-danger-rose/10 text-text-secondary hover:text-danger-rose transition-all"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Welcome Hero / Metrics banner */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-panel p-5 rounded-2xl border-border-primary/60 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Authenticated Recipient
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-success-emerald bg-success-emerald/10 px-2 py-0.5 rounded-md border border-success-emerald/20">
                <ShieldCheck className="w-3 h-3" /> Email Verified
              </span>
            </div>
            <h2 className="text-xl font-bold text-white font-mono break-all mb-1">
              {recipientEmail || "Recipient Vault"}
            </h2>
            <p className="text-xs text-text-secondary leading-relaxed">
              All files below are encrypted with client-side AES-256-GCM. Decryption keys and plaintexts never touch our cloud servers.
            </p>
          </div>

          <div className="glass-panel p-5 rounded-2xl border-border-primary/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Active Transfers
              </span>
              <HardDrive className="w-4 h-4 text-accent-cyan" />
            </div>
            <div className="text-3xl font-extrabold text-white font-mono">
              {activeTransfersCount}
            </div>
            <p className="text-[11px] text-text-secondary mt-1">
              Ready for immediate download & decryption
            </p>
          </div>

          <div className="glass-panel p-5 rounded-2xl border-border-primary/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Dual Integrity
              </span>
              <FileCheck className="w-4 h-4 text-success-emerald" />
            </div>
            <div className="text-base font-bold text-success-emerald font-mono flex items-center gap-1.5 mt-1">
              <Check className="w-4 h-4" /> SHA-256 Dual-Hash
            </div>
            <p className="text-[11px] text-text-secondary mt-1">
              Tamper verification enabled on every transfer
            </p>
          </div>
        </div>

        {/* Quick Transfer Token Lookup Bar */}
        <div className="glass-panel p-4 rounded-xl border-border-primary flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-text-secondary font-mono w-full sm:w-auto">
            <Search className="w-4 h-4 text-accent-cyan shrink-0" />
            <span>Have another Transfer Link or Token?</span>
          </div>
          <form onSubmit={handleQuickLookup} className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
            <input
              type="text"
              value={quickSearchId}
              onChange={(e) => setQuickSearchId(e.target.value)}
              placeholder="Paste Transfer ID (e.g. A3T7zE_sVF6Y)..."
              className="flex-1 px-3 py-2 rounded-lg bg-cyber-dark border border-border-primary focus:border-accent-cyan text-xs font-mono text-white outline-none"
            />
            <button
              type="submit"
              disabled={!quickSearchId.trim()}
              className="px-4 py-2 rounded-lg bg-accent-cyan/20 border border-accent-cyan/40 hover:bg-accent-cyan/30 text-accent-cyan font-semibold text-xs transition-colors shrink-0 disabled:opacity-50"
            >
              Recover
            </button>
          </form>
        </div>

        {/* Transfers Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white tracking-tight">
                Encrypted Transfers Addressed To You
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyber-card border border-border-primary text-text-secondary font-mono">
                {transfers.length}
              </span>
            </div>
            <button
              onClick={fetchTransfers}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-border-primary hover:border-success-emerald text-xs text-text-secondary hover:text-white transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-danger-rose/10 border border-danger-rose/30 flex items-center gap-3 text-xs text-danger-rose">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="glass-panel p-16 rounded-2xl text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-success-emerald animate-spin mx-auto" />
              <p className="text-xs text-text-secondary font-mono">
                Querying encrypted document ledger...
              </p>
            </div>
          ) : transfers.length === 0 ? (
            <div className="glass-panel p-16 rounded-2xl text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-cyber-card border border-border-primary mx-auto flex items-center justify-center">
                <HardDrive className="w-6 h-6 text-text-secondary" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-white">No Transferred Documents Found</h4>
                <p className="text-xs text-text-secondary max-w-md mx-auto">
                  No encrypted files have been addressed to <span className="font-mono text-accent-cyan">{recipientEmail}</span> yet.
                  When a sender shares a package with this email, it will appear here automatically.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/recovery"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyber-card border border-border-primary hover:border-success-emerald text-xs text-success-emerald transition-colors"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Open Manual Decryptor Tool</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {transfers.map((item) => {
                const isActive = item.status === "ACTIVE";

                return (
                  <div
                    key={item.id}
                    className={`glass-panel p-5 sm:p-6 rounded-2xl border transition-all ${
                      isActive
                        ? "border-border-primary hover:border-success-emerald/50 hover:shadow-lg hover:shadow-success-emerald/5"
                        : "border-border-primary/50 opacity-75"
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Transfer info & Files */}
                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-cyber-dark border border-border-primary text-text-primary font-bold">
                            ID: {item.id}
                          </span>

                          {/* Status badge */}
                          {item.status === "ACTIVE" && (
                            <span className="px-2 py-0.5 rounded-full bg-success-emerald/15 border border-success-emerald/30 text-[10px] font-mono font-bold text-success-emerald">
                              ● ACTIVE
                            </span>
                          )}
                          {item.status === "REVOKED" && (
                            <span className="px-2 py-0.5 rounded-full bg-danger-rose/15 border border-danger-rose/30 text-[10px] font-mono font-bold text-danger-rose">
                              REVOKED
                            </span>
                          )}
                          {item.status === "EXPIRED" && (
                            <span className="px-2 py-0.5 rounded-full bg-warning-amber/15 border border-warning-amber/30 text-[10px] font-mono font-bold text-warning-amber">
                              EXPIRED
                            </span>
                          )}
                          {item.status === "LIMIT_REACHED" && (
                            <span className="px-2 py-0.5 rounded-full bg-warning-amber/15 border border-warning-amber/30 text-[10px] font-mono font-bold text-warning-amber">
                              DOWNLOAD LIMIT REACHED
                            </span>
                          )}

                          {item.transferMode === "BLOCKCHAIN" && (
                            <span className="px-2 py-0.5 rounded-full bg-primary-indigo/15 border border-primary-indigo/30 text-[10px] font-mono text-primary-indigo">
                              BLOCKCHAIN NOTARIZED
                            </span>
                          )}
                        </div>

                        {/* Sender info */}
                        <div className="text-xs text-text-secondary flex items-center gap-2">
                          <span>Sender:</span>
                          <span className="font-mono text-text-primary font-medium">{item.senderEmail}</span>
                        </div>

                        {/* Files Enclosed */}
                        <div className="space-y-1.5 pt-1">
                          <div className="text-[11px] uppercase tracking-wider text-text-secondary font-semibold">
                            Enclosed Files ({item.fileCount}):
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item.files.map((file) => (
                              <div
                                key={file.id}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-dark/80 border border-border-primary text-xs font-mono"
                              >
                                <Lock className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
                                <span className="text-white truncate max-w-[200px]" title={safeDecodeFileName(file.fileName)}>
                                  {safeDecodeFileName(file.fileName)}
                                </span>
                                <span className="text-text-secondary text-[11px]">
                                  ({formatBytes(file.fileSize)})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Policy badges */}
                        <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary pt-1">
                          {item.expiresAt && (
                            <div className="flex items-center gap-1.5 font-mono">
                              <Clock className="w-3.5 h-3.5 text-warning-amber" />
                              <span>Expires: {new Date(item.expiresAt).toLocaleString()}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-1.5 font-mono">
                            <Download className="w-3.5 h-3.5 text-text-secondary" />
                            <span>
                              Downloads: {item.downloadCount}
                              {item.maxDownloads ? ` / ${item.maxDownloads}` : " (unlimited)"}
                            </span>
                          </div>

                          {item.hasPassword && (
                            <div className="flex items-center gap-1 text-accent-cyan font-mono">
                              <Key className="w-3 h-3" />
                              <span>Password Protected</span>
                            </div>
                          )}

                          {item.otpEnabled && (
                            <div className="flex items-center gap-1 text-success-emerald font-mono">
                              <ShieldCheck className="w-3 h-3" />
                              <span>OTP Required</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Action CTA */}
                      <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-center gap-2 pt-2 lg:pt-0">
                        <Link
                          href={`/recovery?id=${item.id}`}
                          className={`px-5 py-3 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-lg ${
                            isActive
                              ? "bg-gradient-to-r from-success-emerald to-accent-cyan text-white hover:opacity-90 shadow-success-emerald/20 active:scale-[0.98]"
                              : "bg-cyber-card border border-border-primary text-text-secondary hover:text-white"
                          }`}
                        >
                          <Unlock className="w-4 h-4" />
                          <span>{isActive ? "Decrypt & Download" : "Inspect Recovery"}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>

                        <Link
                          href={`/d/${item.id}`}
                          target="_blank"
                          className="px-3 py-2 rounded-lg border border-border-primary hover:border-accent-cyan text-[11px] text-text-secondary hover:text-white transition-colors flex items-center justify-center gap-1"
                        >
                          <span>Direct Link</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cryptographic Guarantees card */}
        <div className="glass-panel p-6 rounded-2xl border-border-primary space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <ShieldCheck className="w-4 h-4 text-success-emerald" />
            <span>Zero-Knowledge Decryption Protocol</span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed max-w-4xl">
            When you click &ldquo;Decrypt &amp; Download&rdquo;, the encrypted payload is pulled directly into your browser’s volatile memory.
            Your device computes the AES-256-GCM cipher and performs dual SHA-256 hash validation locally. No unencrypted files or plaintext keys are ever transmitted over the network or stored in our database.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-border-primary/60 py-6 text-center text-xs text-text-secondary">
        <p>© 2026 FortressShare • Recipient Recovery Vault • Zero-Knowledge Standard</p>
      </footer>
    </div>
  );
}
