"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Key, Mail, Lock, Fingerprint, ArrowRight, CheckCircle2, ShieldAlert, Smartphone, ArrowLeft, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { startAuthentication } from "@simplewebauthn/browser";

export default function LoginPage() {
  const router = useRouter();
  
  // Tabs: "login" | "register" | "mfa" | "forgot-password"
  const [activeTab, setActiveTab] = useState<"login" | "register" | "mfa" | "forgot-password">("login");
  
  // Form input fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  
  // MFA States
  const [mfaUserId, setMfaUserId] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  // Forgot Password / SMS OTP states
  const [fpStep, setFpStep] = useState<"request" | "verify" | "reset">("request");
  const [fpIdentifier, setFpIdentifier] = useState("");
  const [fpPhoneInput, setFpPhoneInput] = useState("");
  const [fpRequiresPhone, setFpRequiresPhone] = useState(false);
  const [fpOtpCode, setFpOtpCode] = useState("");
  const [fpMaskedPhone, setFpMaskedPhone] = useState("");
  const [fpResetToken, setFpResetToken] = useState("");
  const [fpNewPassword, setFpNewPassword] = useState("");
  const [fpConfirmPassword, setFpConfirmPassword] = useState("");
  const [fpCooldown, setFpCooldown] = useState(0);


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

  // SMS OTP: Request password reset verification code via TextBee
  const handleSendSmsOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: fpIdentifier,
          phone: fpPhoneInput || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.requiresPhoneInput) {
          setFpRequiresPhone(true);
        }
        throw new Error(data.error || "Failed to send SMS OTP");
      }

      setFpMaskedPhone(data.maskedPhone);
      setFpStep("verify");
      setFpCooldown(60);
      setSuccess(data.message || `SMS verification code dispatched via TextBee.`);

      // 60-second resend cooldown timer
      const interval = setInterval(() => {
        setFpCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // SMS OTP: Verify verification code
  const handleVerifySmsOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: fpIdentifier,
          otpCode: fpOtpCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to verify SMS code");
      }

      setFpResetToken(data.resetToken);
      setFpStep("reset");
      setSuccess(data.message || "Code verified. Please set your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // SMS OTP: Set new password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (fpNewPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }

    if (fpNewPassword !== fpConfirmPassword) {
      setError("Passwords do not match. Please verify.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resetToken: fpResetToken,
          newPassword: fpNewPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      setSuccess("Password updated successfully! Redirecting to sign in...");
      setTimeout(() => {
        setActiveTab("login");
        setFpStep("request");
        setFpOtpCode("");
        setFpNewPassword("");
        setFpConfirmPassword("");
        setPassword("");
        setSuccess("");
      }, 2500);
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
        {activeTab !== "mfa" && activeTab !== "forgot-password" && (
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
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-text-secondary">Access Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("forgot-password");
                      setFpStep("request");
                      setError("");
                      setSuccess("");
                      setFpIdentifier(email || "");
                    }}
                    className="text-[11px] text-primary-indigo hover:text-indigo-400 font-mono transition-colors cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
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

          {activeTab === "forgot-password" && (
            <motion.div
              key="forgot-password"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-border-primary/60">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("login");
                    setError("");
                    setSuccess("");
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary font-mono transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                </button>
                <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                  <Smartphone className="w-3 h-3" /> TextBee SMS OTP
                </span>
              </div>

              {/* STEP 1: Enter email or phone to receive SMS OTP */}
              {fpStep === "request" && (
                <form onSubmit={handleSendSmsOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-2">
                      Registered Email Address or Phone
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                      <input
                        type="text"
                        value={fpIdentifier}
                        onChange={(e) => setFpIdentifier(e.target.value)}
                        required
                        placeholder="name@domain.com or +919876543210"
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                      />
                    </div>
                  </div>

                  {fpRequiresPhone && (
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-2">
                        Mobile Phone Number (E.164)
                      </label>
                      <div className="relative">
                        <Smartphone className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                        <input
                          type="tel"
                          value={fpPhoneInput}
                          onChange={(e) => setFpPhoneInput(e.target.value)}
                          required
                          placeholder="+919876543210"
                          className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-indigo-500/40 focus:border-primary-indigo/70 focus:outline-none text-sm text-text-primary transition-all font-mono"
                        />
                      </div>
                      <p className="text-[10px] font-mono text-text-secondary mt-1">
                        Link your phone number to receive the TextBee SMS verification code.
                      </p>
                    </div>
                  )}

                  <div className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl text-[11px] font-mono text-text-secondary flex gap-2.5 items-start">
                    <Smartphone className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                    <div>
                      A 6-digit one-time code will be dispatched via <strong>TextBee SMS Gateway</strong> to your registered mobile device.
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
                  >
                    {loading ? "Dispatching SMS..." : "Send SMS Verification Code"}{" "}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              )}

              {/* STEP 2: Enter 6-digit SMS OTP */}
              {fpStep === "verify" && (
                <form onSubmit={handleVerifySmsOtp} className="space-y-4">
                  <div className="text-center space-y-1">
                    <div className="text-xs font-mono text-text-secondary">Code dispatched to</div>
                    <div className="text-sm font-bold font-mono text-indigo-400">{fpMaskedPhone}</div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-2 font-mono text-center">
                      6-Digit SMS OTP
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      value={fpOtpCode}
                      onChange={(e) => setFpOtpCode(e.target.value.replace(/\D/g, ""))}
                      required
                      placeholder="000000"
                      className="w-44 mx-auto block text-center tracking-[12px] pl-3 py-3 rounded-xl bg-cyber-dark border border-indigo-500/40 focus:border-indigo-400 focus:outline-none text-lg text-primary-indigo font-mono font-bold transition-all"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || fpOtpCode.length !== 6}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all disabled:opacity-50"
                  >
                    {loading ? "Verifying..." : "Verify SMS Code"} <ArrowRight className="w-4 h-4" />
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setFpStep("request")}
                      className="text-xs font-mono text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      Change Phone/Email
                    </button>

                    <button
                      type="button"
                      onClick={handleSendSmsOtp}
                      disabled={loading || fpCooldown > 0}
                      className="text-xs font-mono text-indigo-400 hover:text-indigo-300 disabled:text-text-secondary transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {fpCooldown > 0 ? `Resend SMS (${fpCooldown}s)` : "Resend SMS"}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: Enter New Password */}
              {fpStep === "reset" && (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-2">New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                      <input
                        type="password"
                        value={fpNewPassword}
                        onChange={(e) => setFpNewPassword(e.target.value)}
                        required
                        placeholder="Minimum 8 characters"
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-2">Confirm New Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4.5 h-4.5 text-text-secondary" />
                      <input
                        type="password"
                        value={fpConfirmPassword}
                        onChange={(e) => setFpConfirmPassword(e.target.value)}
                        required
                        placeholder="Re-type new password"
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-cyber-dark border border-border-primary focus:border-primary-indigo/50 focus:outline-none text-sm text-text-primary transition-all font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-indigo-600 hover:opacity-95 text-white font-medium text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
                  >
                    {loading ? "Updating Password..." : "Update Password & Sign In"}{" "}
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
}
