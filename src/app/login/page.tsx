"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Key, Mail, Lock, Fingerprint, ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { startAuthentication } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  
  // Tabs: "login" | "register" | "mfa"
  const [activeTab, setActiveTab] = useState<"login" | "register" | "mfa">("login");
  
  // Form input fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  
  // MFA States
  const [mfaUserId, setMfaUserId] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  // traditional email & password register
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const pubKey = "mock_public_key_" + Math.random().toString(36).substring(2);

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, publicKey: pubKey }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Registration failed");
      }

      setSuccess("Account secured successfully! Switching to sign in...");
      setTimeout(() => {
        setActiveTab("login");
        setSuccess("");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // traditional login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      
      if (res.status === 403) {
        throw new Error(data.error || "Blocked due to security policy");
      }

      if (!res.ok) {
        throw new Error(data.error || "Invalid username or password");
      }

      if (data.mfaRequired) {
        setMfaUserId(data.userId);
        setActiveTab("mfa");
        setLoading(false);
        return;
      }

      setSuccess("Authentication success. Securing session...");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  // mfa verification
  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: mfaCode, userId: mfaUserId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Incorrect verification code");
      }

      setSuccess("MFA authentication verified. Entering portal...");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // passkey (WebAuthn) login
  const handlePasskeyLogin = async () => {
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const optionsRes = await fetch(`/api/auth/passkeys?action=login-options${email ? `&email=${encodeURIComponent(email)}` : ""}`);
      if (!optionsRes.ok) {
        const errorData = await optionsRes.json();
        throw new Error(errorData.error || "Failed to load passkey challenge parameters");
      }
      const options = await optionsRes.json();

      const credential = await startAuthentication({
        optionsJSON: options,
      });

      const verifyRes = await fetch("/api/auth/passkeys?action=login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || "WebAuthn authentication failed");
      }

      setSuccess("Biometric authentication verified. Welcome back.");
      router.push("/dashboard");
    } catch (err) {
      const errorObj = err as { name?: string; message?: string };
      if (errorObj.name === "NotAllowedError") {
        console.warn("WebAuthn biometric challenge canceled or rejected by browser environment context.");
        setError("Biometric validation was canceled, timed out, or not supported. Ensure you are accessing via localhost or HTTPS, your device supports biometrics, and you have registered a passkey first.");
      } else {
        console.error(err);
        setError(errorObj.message || "Failed to authenticate with Passkey");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-20 relative z-10 select-none bg-cyber-dark text-text-primary">
      {/* Visual background glows */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-primary-indigo/5 blur-3xl pulse-cyber" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-primary-purple/5 blur-3xl pulse-cyber" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md glass-panel rounded-2xl p-8 relative overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-primary-indigo to-primary-purple flex items-center justify-center glow-indigo mb-3">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">
            FortressShare Exchange
          </h2>
          <p className="text-xs text-text-secondary mt-1 uppercase tracking-wider font-mono text-[10px]">
            Cryptographic Authentication
          </p>
        </div>

        {/* Dynamic Alerts */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-xs flex gap-2.5 items-start mb-5"
            >
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs flex gap-2.5 items-start mb-5"
            >
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>{success}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab Selector */}
        {activeTab !== "mfa" && (
          <div className="flex bg-cyber-dark p-1 rounded-xl border border-border-primary mb-6">
            <button
              onClick={() => { setActiveTab("login"); setError(""); }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === "login"
                  ? "bg-primary-indigo text-white shadow-md glow-indigo"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setActiveTab("register"); setError(""); }}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === "register"
                  ? "bg-primary-indigo text-white shadow-md glow-indigo"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === "login" && (
            <motion.form
              key="login"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={handleLogin}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="name@domain.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Access Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
              >
                {loading ? "Authenticating..." : "Authorize Access"} <ArrowRight className="w-4 h-4" />
              </button>

              <div className="relative my-6 text-center">
                <hr className="border-border-primary" />
                <span className="bg-cyber-card px-3 text-xs text-text-secondary absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 uppercase tracking-widest font-mono text-[9px]">
                  or secure verify
                </span>
              </div>

              {/* Passkey Login Button */}
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={loading}
                className="w-full py-3 rounded-xl border border-primary-indigo/25 hover:border-primary-indigo/40 bg-primary-indigo/5 text-primary-indigo font-mono text-xs flex items-center justify-center gap-2.5 cursor-pointer transition-all"
              >
                <Fingerprint className="w-4.5 h-4.5 text-primary-indigo animate-pulse" /> Sign In with Passkey (WebAuthn)
              </button>
            </motion.form>
          )}

          {activeTab === "register" && (
            <motion.form
              key="register"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={handleRegister}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="name@domain.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">Account Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-primary-indigo/5 border border-primary-indigo/10 rounded-xl flex gap-3 text-[11px] text-text-secondary leading-relaxed font-mono">
                <Key className="w-5 h-5 flex-shrink-0 text-primary-indigo" />
                <div>
                  System generates an ephemeral user key pair locally. Private keys are never transmitted.
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
              >
                {loading ? "Generating Safe Node..." : "Initialize Private Account"} <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          )}

          {activeTab === "mfa" && (
            <motion.form
              key="mfa"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onSubmit={handleMfaSubmit}
              className="space-y-5"
            >
              <div className="text-center space-y-2">
                <div className="text-sm font-bold text-text-primary">Microsoft Authenticator Required</div>
                <p className="text-xs text-text-secondary font-mono">
                  Enter the 6-digit OTP code from your Microsoft Authenticator app.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2 font-mono text-center">Microsoft OTP Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                  placeholder="000000"
                  className="w-40 mx-auto block text-center tracking-[12px] pl-3 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-lg text-primary-indigo font-mono font-bold transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
              >
                {loading ? "Verifying..." : "Verify & Unlock"} <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("login"); setMfaCode(""); setError(""); }}
                className="w-full py-2 text-center text-xs text-text-secondary hover:text-text-primary transition-all font-mono"
              >
                Cancel Authentication
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
