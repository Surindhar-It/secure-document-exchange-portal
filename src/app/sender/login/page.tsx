"use client";

import React from "react";
import Link from "next/link";
import LoginPage from "@/app/login/page";
import { Shield, ArrowRight, KeyRound, ExternalLink } from "lucide-react";

export default function SenderLoginPage() {
  return (
    <div className="relative min-h-screen bg-cyber-dark text-text-primary flex flex-col">
      {/* Top Banner highlighting Sender Portal context with quick toggle to Recovery Portal */}
      <div className="w-full bg-primary-indigo/10 border-b border-primary-indigo/20 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-primary-indigo">
            <span className="inline-block w-2 h-2 rounded-full bg-primary-indigo animate-pulse" />
            <span className="font-semibold tracking-wide uppercase font-mono">
              Sender Portal • Originator & Encryption Vault
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-text-secondary">Are you a recipient accessing a shared file?</span>
            <Link
              href="/recovery/login"
              className="inline-flex items-center gap-1 font-semibold text-accent-cyan hover:underline hover:text-white transition-colors"
            >
              Switch to Recovery Portal <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Login Component */}
      <div className="flex-1">
        <LoginPage />
      </div>
    </div>
  );
}
