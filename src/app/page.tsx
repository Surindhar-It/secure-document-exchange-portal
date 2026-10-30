"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shield, ArrowRight, Lock, Hourglass, Cpu, Activity,
  Unlock, Key, Download, UploadCloud, ShieldCheck, FileCheck,
  Search, ExternalLink, Sparkles, CheckCircle2, Layers
} from "lucide-react";
import { motion } from "framer-motion";

export default function LandingPage() {
  const router = useRouter();
  const [quickTransferId, setQuickTransferId] = useState("");

  const handleQuickLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickTransferId.trim();
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

  return (
    <div className="flex-1 flex flex-col relative z-10 select-none bg-cyber-dark text-text-primary selection:bg-primary-indigo selection:text-white">
      {/* Top Navbar */}
      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between border-b border-border-primary/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-indigo to-primary-purple flex items-center justify-center glow-indigo shadow-lg shadow-primary-indigo/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-xl font-extrabold tracking-tight text-white block leading-tight">
              FortressShare
            </span>
            <span className="text-[10px] font-mono text-text-secondary uppercase tracking-wider block">
              Zero-Knowledge Exchange
            </span>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/recovery/login"
            className="px-3.5 py-2 rounded-xl border border-success-emerald/30 hover:border-success-emerald bg-success-emerald/5 hover:bg-success-emerald/10 text-xs font-semibold text-success-emerald transition-all duration-200 flex items-center gap-1.5"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Recovery Portal</span>
            <span className="sm:hidden">Recipient</span>
          </Link>

          <Link
            href="/sender/login"
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-xs font-semibold text-white shadow-md shadow-primary-indigo/20 transition-all duration-200 flex items-center gap-1.5"
          >
            <Shield className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sender Portal</span>
            <span className="sm:hidden">Sender</span>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow w-full max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-20 flex flex-col items-center justify-center text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-primary-indigo/30 bg-primary-indigo/10 text-xs text-primary-indigo font-mono">
          <ShieldCheck className="w-4 h-4 text-primary-indigo" />
          <span>MIL-SPEC AES-256-GCM CLIENT ENCRYPTION</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.1] text-text-primary max-w-4xl">
          Zero-Knowledge Document Exchange{" "}
          <span className="bg-gradient-to-r from-primary-indigo via-accent-cyan to-success-emerald bg-clip-text text-transparent">
            &amp; Instant Recovery
          </span>
        </h1>

        <p className="text-sm sm:text-base text-text-secondary max-w-2xl leading-relaxed">
          The sovereign file exchange network designed for end-to-end privacy. Choose your portal below to either originate and distribute encrypted files or securely recover incoming transfers.
        </p>

        {/* DUAL PORTAL CARDS */}
        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 text-left">
          {/* PORTAL 1: SENDER PORTAL */}
          <div className="glass-panel p-7 sm:p-8 rounded-2xl border-2 border-primary-indigo/40 hover:border-primary-indigo bg-gradient-to-b from-primary-indigo/5 to-transparent transition-all duration-300 relative flex flex-col justify-between group shadow-xl hover:shadow-primary-indigo/10">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full bg-primary-indigo/15 border border-primary-indigo/30 text-[10px] font-mono font-bold text-primary-indigo uppercase tracking-wider">
                  Sender Portal • Originator
                </span>
                <div className="w-12 h-12 rounded-xl bg-primary-indigo/15 border border-primary-indigo/30 flex items-center justify-center text-primary-indigo group-hover:scale-105 transition-transform">
                  <UploadCloud className="w-6 h-6" />
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight">
                  Sender Portal
                </h3>
                <p className="text-xs text-text-secondary mt-1">
                  Upload, client-encrypt, set ephemeral barriers, and manage secure sharing links.
                </p>
              </div>

              {/* Capabilities checklist */}
              <ul className="space-y-2.5 text-xs text-text-secondary pt-2">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary-indigo shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Client-Side Encryption:</strong> AES-256-GCM in-browser cryptography before cloud upload.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary-indigo shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Ephemeral Access Controls:</strong> Password locks, email OTP checks, download limits &amp; expiry timers.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary-indigo shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">File Bundles &amp; Steganography:</strong> Multi-file transfers (up to 20 files) and image carrier hiding.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary-indigo shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Audit &amp; Telemetry:</strong> Real-time download monitoring, instant link revocation &amp; tamper logs.
                  </span>
                </li>
              </ul>
            </div>

            {/* CTAs */}
            <div className="pt-8 space-y-2.5">
              <Link
                href="/sender/login"
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-90 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-primary-indigo/20 transition-all flex items-center justify-center gap-2"
              >
                <span>Access Sender Portal</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="flex items-center justify-between text-xs px-1">
                <Link
                  href="/dashboard"
                  className="text-text-secondary hover:text-white transition-colors"
                >
                  Direct to Sender Dashboard →
                </Link>
                <Link
                  href="/sender/login"
                  className="text-primary-indigo hover:underline font-mono"
                >
                  Register as Sender
                </Link>
              </div>
            </div>
          </div>

          {/* PORTAL 2: RECOVERY PORTAL */}
          <div className="glass-panel p-7 sm:p-8 rounded-2xl border-2 border-success-emerald/40 hover:border-success-emerald bg-gradient-to-b from-success-emerald/5 to-transparent transition-all duration-300 relative flex flex-col justify-between group shadow-xl hover:shadow-success-emerald/10">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 rounded-full bg-success-emerald/15 border border-success-emerald/30 text-[10px] font-mono font-bold text-success-emerald uppercase tracking-wider">
                  Recovery Portal • Recipient
                </span>
                <div className="w-12 h-12 rounded-xl bg-success-emerald/15 border border-success-emerald/30 flex items-center justify-center text-success-emerald group-hover:scale-105 transition-transform">
                  <Unlock className="w-6 h-6" />
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight">
                  Recovery Portal
                </h3>
                <p className="text-xs text-text-secondary mt-1">
                  Authenticate your recipient email, decrypt password tokens, and reconstitute files.
                </p>
              </div>

              {/* Capabilities checklist */}
              <ul className="space-y-2.5 text-xs text-text-secondary pt-2">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-success-emerald shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Passwordless Recipient Vault:</strong> Sign in instantly via 6-digit email OTP to see incoming transfers.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-success-emerald shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Auto-Decrypt Password Ciphers:</strong> Reconstruct encrypted 64-bit KMS tokens directly in your browser.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-success-emerald shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Dual-Layer SHA-256 Integrity:</strong> Validates encrypted payload &amp; decrypted document against tampering.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-success-emerald shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Direct Transfer Access:</strong> Recover single files instantly with a Transfer ID without an account.
                  </span>
                </li>
              </ul>
            </div>

            {/* CTAs */}
            <div className="pt-8 space-y-2.5">
              <Link
                href="/recovery/login"
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-success-emerald to-accent-cyan hover:opacity-90 active:scale-[0.99] text-white font-semibold text-sm shadow-lg shadow-success-emerald/20 transition-all flex items-center justify-center gap-2"
              >
                <span>Access Recovery Portal</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="flex items-center justify-between text-xs px-1">
                <Link
                  href="/recovery/dashboard"
                  className="text-text-secondary hover:text-white transition-colors"
                >
                  Direct to Recipient Vault →
                </Link>
                <Link
                  href="/recovery"
                  className="text-success-emerald hover:underline font-mono"
                >
                  Open Decryptor Tool
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Transfer Lookup Bar */}
        <div className="w-full max-w-3xl pt-4">
          <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-border-primary/80 bg-cyber-card/80 text-left space-y-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-accent-cyan" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Have a Transfer Link or Token? Quick Decrypt:
              </span>
            </div>
            <form onSubmit={handleQuickLookup} className="flex flex-col sm:flex-row items-center gap-2.5">
              <input
                type="text"
                value={quickTransferId}
                onChange={(e) => setQuickTransferId(e.target.value)}
                placeholder="Paste Transfer ID (e.g. A3T7zE_sVF6Y) or full sharing URL..."
                className="flex-1 w-full px-4 py-3 rounded-xl bg-cyber-dark/80 border border-border-primary focus:border-accent-cyan text-xs font-mono text-white outline-none placeholder:text-text-secondary/50"
              />
              <button
                type="submit"
                disabled={!quickTransferId.trim()}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-accent-cyan/20 border border-accent-cyan/40 hover:bg-accent-cyan/30 text-accent-cyan font-semibold text-xs transition-colors shrink-0 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Verify &amp; Recover</span>
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-20 border-t border-border-primary/60">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-primary-indigo font-bold">
            Zero-Knowledge Cryptographic Architecture
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Engineered for Sovereign Privacy
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="glass-panel p-6 rounded-xl space-y-3 border-border-primary/60">
            <div className="w-10 h-10 rounded-lg bg-primary-indigo/15 border border-primary-indigo/30 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary-indigo" />
            </div>
            <h3 className="text-base font-bold text-white">In-Memory Encryption</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Files are locked with client-side WebCrypto AES-GCM-256 before leaving your browser.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-3 border-border-primary/60">
            <div className="w-10 h-10 rounded-lg bg-primary-purple/15 border border-primary-purple/30 flex items-center justify-center">
              <Hourglass className="w-5 h-5 text-primary-purple" />
            </div>
            <h3 className="text-base font-bold text-white">Ephemeral Lifecycles</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Generate self-destructing transfers with strict download caps and automated expiry windows.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-3 border-border-primary/60">
            <div className="w-10 h-10 rounded-lg bg-accent-cyan/15 border border-accent-cyan/30 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-accent-cyan" />
            </div>
            <h3 className="text-base font-bold text-white">Multi-Tier Barriers</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Enforce password challenges, 6-digit email OTPs, and geofencing verification before access.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-3 border-border-primary/60">
            <div className="w-10 h-10 rounded-lg bg-success-emerald/15 border border-success-emerald/30 flex items-center justify-center">
              <Activity className="w-5 h-5 text-success-emerald" />
            </div>
            <h3 className="text-base font-bold text-white">Dual-Layer Tamper Auditing</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Dual SHA-256 verification confirms ciphertext and reconstituted plaintext match the source.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 border-t border-border-primary/40 text-center text-xs text-text-secondary flex flex-col sm:flex-row items-center justify-between gap-4">
        <p>© 2026 FortressShare. Zero-Knowledge Cryptographic Platform.</p>
        <div className="flex items-center gap-4 text-xs font-mono">
          <Link href="/sender/login" className="hover:text-primary-indigo transition-colors">
            Sender Portal
          </Link>
          <span>•</span>
          <Link href="/recovery/login" className="hover:text-success-emerald transition-colors">
            Recovery Portal
          </Link>
          <span>•</span>
          <Link href="/recovery" className="hover:text-accent-cyan transition-colors">
            Direct Decryptor
          </Link>
        </div>
      </footer>
    </div>
  );
}
