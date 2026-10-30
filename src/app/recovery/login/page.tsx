"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield, Key, Mail, Lock, ArrowRight, ShieldCheck, RefreshCw,
  Search, Unlock, CheckCircle2, ShieldAlert, Sparkles, ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RecoveryLoginPage() {
  const router = useRouter();

  // Mode: "email_otp" (login to recipient vault) | "direct_lookup" (instant link decryptor)
  const [activeTab, setActiveTab] = useState<"email_otp" | "direct_lookup">("email_otp");

  // Email OTP States
  const [email, setEmail] = useState("");
  const [otpStep, setOtpStep] = useState<"email" | "otp">("email");
  const [otpCode, setOtpCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Direct Lookup States
  const [transferInput, setTransferInput] = useState("");
  const [passwordCipherInput, setPasswordCipherInput] = useState("");

  // Status & UI States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Step 1: Send OTP to Recipient Email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes("@")) {
        throw new Error("Please enter a valid recipient email address.");
      }

      const res = await fetch("/api/auth/recovery-login/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch verification code.");
      }

      setMaskedEmail(data.maskedEmail || cleanEmail);
      setDevCode(data.devCode || null);
      setOtpStep("otp");
      setCooldown(60);
      setSuccess(data.message || `Verification code dispatched to ${data.maskedEmail}.`);

      const timer = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify Recipient OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const cleanOtp = otpCode.trim();
      if (!cleanOtp || cleanOtp.length < 6) {
        throw new Error("Please enter the complete 6-digit verification code.");
      }

      const res = await fetch("/api/auth/recovery-login/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otpCode: cleanOtp,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Verification failed.");
      }

      setSuccess("Identity verified! Entering Recipient Document Vault...");
      setTimeout(() => {
        router.push("/recovery/dashboard");
      }, 1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Direct Transfer Token Navigation
  const handleDirectLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const input = transferInput.trim();
    if (!input) {
      setError("Please enter a Transfer ID or secure sharing link.");
      return;
    }

    // Extract ID from full URL or use raw token
    let cleanId = input;
    if (input.includes("/d/")) {
      cleanId = input.split("/d/")[1]?.split("?")[0] || input;
    } else if (input.includes("id=")) {
      try {
        const urlObj = new URL(input.startsWith("http") ? input : `https://example.com/${input}`);
        cleanId = urlObj.searchParams.get("id") || input;
      } catch {
        cleanId = input;
      }
    }

    cleanId = cleanId.replace(/[^a-zA-Z0-9_\-]/g, "");

    if (!cleanId) {
      setError("Invalid Transfer ID or link format.");
      return;
    }

    const cipher = passwordCipherInput.trim();
    let targetUrl = `/recovery?id=${encodeURIComponent(cleanId)}`;
    if (cipher) {
      targetUrl += `&cipher=${encodeURIComponent(cipher)}`;
    }

    router.push(targetUrl);
  };

  return (
    <div className="min-h-screen bg-cyber-dark text-text-primary flex flex-col justify-between selection:bg-success-emerald selection:text-white">
      {/* Top Banner */}
      <div className="w-full bg-success-emerald/10 border-b border-success-emerald/20 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-success-emerald">
            <span className="inline-block w-2 h-2 rounded-full bg-success-emerald animate-pulse" />
            <span className="font-semibold tracking-wide uppercase font-mono">
              Recovery Portal • Recipient & Decryption Access
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-text-secondary">Are you an originator uploading files?</span>
            <Link
              href="/sender/login"
              className="inline-flex items-center gap-1 font-semibold text-primary-indigo hover:underline hover:text-white transition-colors"
            >
              Switch to Sender Portal <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Brand header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-success-emerald to-accent-cyan p-0.5 shadow-lg shadow-success-emerald/20 mb-4">
              <div className="w-full h-full bg-cyber-card rounded-[14px] flex items-center justify-center">
                <Unlock className="w-8 h-8 text-success-emerald" />
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
              Recovery Portal Access
            </h1>
            <p className="text-sm text-text-secondary">
              Authenticate your recipient identity or enter a transfer token to decrypt shared documents
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 p-1 bg-cyber-card border border-border-primary rounded-xl mb-6">
            <button
              type="button"
              onClick={() => {
                setActiveTab("email_otp");
                setError("");
                setSuccess("");
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
                activeTab === "email_otp"
                  ? "bg-gradient-to-r from-success-emerald/20 to-accent-cyan/20 text-success-emerald border border-success-emerald/30 shadow-sm"
                  : "text-text-secondary hover:text-white"
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Recipient Vault
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("direct_lookup");
                setError("");
                setSuccess("");
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
                activeTab === "direct_lookup"
                  ? "bg-gradient-to-r from-success-emerald/20 to-accent-cyan/20 text-success-emerald border border-success-emerald/30 shadow-sm"
                  : "text-text-secondary hover:text-white"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              Direct Transfer
            </button>
          </div>

          {/* Card Container */}
          <div className="glass-panel border-border-primary/60 p-6 sm:p-8 rounded-2xl relative shadow-2xl backdrop-blur-xl">
            {/* Notifications */}
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-danger-rose/10 border border-danger-rose/30 flex items-start gap-3 text-xs text-danger-rose">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{error}</div>
              </div>
            )}

            {success && (
              <div className="mb-6 p-4 rounded-xl bg-success-emerald/10 border border-success-emerald/30 flex items-start gap-3 text-xs text-success-emerald">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{success}</div>
              </div>
            )}

            {/* TAB 1: Recipient Vault Login (Email OTP) */}
            {activeTab === "email_otp" && (
              <AnimatePresence mode="wait">
                {otpStep === "email" ? (
                  <motion.form
                    key="email-step"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    onSubmit={handleSendOtp}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                        Recipient Email Address
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-text-secondary absolute left-3.5 top-3.5" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="recipient@company.com"
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark/60 border border-border-primary focus:border-success-emerald focus:ring-1 focus:ring-success-emerald text-sm outline-none transition-all placeholder:text-text-secondary/50 font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-text-secondary mt-2">
                        Enter the email where your encrypted files were dispatched. We will send a one-time cryptographic passcode.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || !email}
                      className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-success-emerald to-accent-cyan hover:opacity-90 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-success-emerald/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Generating Secure Passcode...</span>
                        </>
                      ) : (
                        <>
                          <span>Send Recipient Access Code</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </motion.form>
                ) : (
                  <motion.form
                    key="otp-step"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    onSubmit={handleVerifyOtp}
                    className="space-y-5"
                  >
                    <div className="text-center space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-emerald/10 border border-success-emerald/30 text-xs text-success-emerald font-mono">
                        <ShieldCheck className="w-3.5 h-3.5" /> Code Dispatched
                      </div>
                      <p className="text-xs text-text-secondary pt-1">
                        Enter the 6-digit passcode sent to: <span className="font-mono text-white font-semibold">{maskedEmail}</span>
                      </p>
                    </div>

                    <div>
                      <input
                        type="text"
                        maxLength={6}
                        autoFocus
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="••••••"
                        className="w-full text-center tracking-[10px] font-mono font-bold text-2xl py-3 rounded-xl bg-cyber-dark/80 border border-success-emerald/50 focus:border-success-emerald focus:ring-2 focus:ring-success-emerald/30 text-white outline-none"
                      />
                    </div>

                    {devCode && (
                      <div className="p-3 bg-cyber-dark/70 rounded-lg border border-border-primary text-center">
                        <span className="text-[10px] uppercase tracking-wider text-text-secondary block">
                          Local Simulation Passcode
                        </span>
                        <code className="text-xs font-mono font-bold text-success-emerald tracking-widest">
                          {devCode}
                        </code>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading || otpCode.length < 6}
                      className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-success-emerald to-accent-cyan hover:opacity-90 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-success-emerald/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Verifying Identity...</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4" />
                          <span>Authorize & Enter Recipient Vault</span>
                        </>
                      )}
                    </button>

                    <div className="flex items-center justify-between text-xs pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOtpStep("email");
                          setOtpCode("");
                          setError("");
                        }}
                        className="text-text-secondary hover:text-white transition-colors"
                      >
                        ← Change Email
                      </button>

                      <button
                        type="button"
                        disabled={cooldown > 0 || loading}
                        onClick={handleSendOtp}
                        className="text-success-emerald font-semibold disabled:text-text-secondary/50 hover:underline"
                      >
                        {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            )}

            {/* TAB 2: Direct Transfer Lookup */}
            {activeTab === "direct_lookup" && (
              <form onSubmit={handleDirectLookup} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                    Transfer ID or Secure Share Link
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-text-secondary absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      value={transferInput}
                      onChange={(e) => setTransferInput(e.target.value)}
                      placeholder="e.g. A3T7zE_sVF6Y or https://.../recovery?id=..."
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark/60 border border-border-primary focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan text-sm outline-none transition-all placeholder:text-text-secondary/50 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wider">
                    Encrypted Password Token <span className="text-text-secondary/60 lowercase">(optional)</span>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-text-secondary absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      value={passwordCipherInput}
                      onChange={(e) => setPasswordCipherInput(e.target.value)}
                      placeholder="Paste 64-bit cipher token from notification email"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark/60 border border-border-primary focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan text-xs outline-none transition-all placeholder:text-text-secondary/50 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!transferInput.trim()}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-accent-cyan to-success-emerald hover:opacity-90 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-accent-cyan/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Open Document Recovery & Decryptor</span>
                </button>

                <p className="text-[11px] text-center text-text-secondary pt-2">
                  No account required for direct token recovery. Files are decrypted client-side in memory.
                </p>
              </form>
            )}
          </div>

          {/* Footer note */}
          <div className="mt-8 text-center text-xs text-text-secondary space-y-2">
            <div className="flex items-center justify-center gap-2 text-text-secondary/70">
              <ShieldCheck className="w-3.5 h-3.5 text-success-emerald" />
              <span>AES-256-GCM Zero-Knowledge Client Reconstitution</span>
            </div>
            <p>© 2026 FortressShare • Recipient Recovery Engine</p>
          </div>
        </div>
      </div>
    </div>
  );
}
