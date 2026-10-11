"use client";

import React from "react";
import Link from "next/link";
import { Shield, ArrowRight, Lock, Hourglass, Cpu, Activity } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex-1 flex flex-col relative z-10 select-none bg-cyber-dark text-text-primary">
      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-indigo to-primary-purple flex items-center justify-center glow-indigo">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-text-primary">
            FortressShare
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="px-5 py-2.5 rounded-xl border border-border-primary hover:border-primary-indigo bg-cyber-card text-sm font-medium transition-all duration-300 backdrop-blur-sm hover:text-primary-indigo">
            Enter Portal
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow w-full max-w-4xl mx-auto px-6 pt-24 pb-32 flex flex-col items-center justify-center text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary-indigo/20 bg-primary-indigo/5 text-xs text-primary-indigo font-medium">
          <Shield className="w-3.5 h-3.5" /> Zero-Knowledge Standard
        </div>
        
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-text-primary max-w-3xl">
          Secure File Exchange{" "}
          <span className="bg-gradient-to-r from-primary-indigo via-primary-purple to-accent-cyan bg-clip-text text-transparent">
            with Ephemeral Control
          </span>
        </h1>
        
        <p className="text-lg text-text-secondary max-w-2xl leading-relaxed">
          Encrypt your files in the browser before they hit the cloud. Share them using self-destructing links, password protection, and custom barriers.
        </p>

        <div className="flex justify-center pt-4">
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-90 text-white font-medium shadow-lg transition-all duration-300 text-base"
          >
            Get Started Free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </main>

      {/* Features Grid */}
      <section className="w-full max-w-7xl mx-auto px-6 py-20 border-t border-border-primary">
        <h2 className="text-3xl font-extrabold tracking-tight text-center text-text-primary mb-12">
          Designed for Complete Privacy
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="glass-panel p-6 rounded-xl space-y-4">
            <div className="w-10 h-10 rounded-lg bg-primary-indigo/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary-indigo" />
            </div>
            <h3 className="text-lg font-bold text-text-primary">Client Encryption</h3>
            <p className="text-sm text-text-secondary">
              Files are locked in-memory with AES-GCM-256 before leaving your browser.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-4">
            <div className="w-10 h-10 rounded-lg bg-primary-purple/10 flex items-center justify-center">
              <Hourglass className="w-5 h-5 text-primary-purple" />
            </div>
            <h3 className="text-lg font-bold text-text-primary">Ephemeral Control</h3>
            <p className="text-sm text-text-secondary">
              Generate self-destructing links with specific download counts and expiration dates.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-4">
            <div className="w-10 h-10 rounded-lg bg-primary-indigo/10 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-primary-indigo" />
            </div>
            <h3 className="text-lg font-bold text-text-primary">Access Barriers</h3>
            <p className="text-sm text-text-secondary">
              Enforce passcode requirements, OTP verification, and custom geofencing bounds.
            </p>
          </div>

          <div className="glass-panel p-6 rounded-xl space-y-4">
            <div className="w-10 h-10 rounded-lg bg-success-emerald/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-success-emerald" />
            </div>
            <h3 className="text-lg font-bold text-text-primary">Audit Integrity</h3>
            <p className="text-sm text-text-secondary">
              Track sharing activity with immutable tamper-evident ledger logs.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-8 border-t border-border-primary text-center text-xs text-text-secondary">
        <p>© 2026 FortressShare. Zero-Knowledge Cryptographic Platform.</p>
      </footer>
    </div>
  );
}
