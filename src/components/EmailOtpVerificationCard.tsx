"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mail, Clock, RefreshCw, CheckCircle2, AlertOctagon, KeyRound, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface EmailOtpVerificationCardProps {
  linkId: string;
  maskedEmail?: string | null;
  onVerified: (sessionToken: string) => void;
  isVerified?: boolean;
  disabled?: boolean;
}

export default function EmailOtpVerificationCard({
  linkId,
  maskedEmail,
  onVerified,
  isVerified = false,
  disabled = false,
}: EmailOtpVerificationCardProps) {
  // OTP flow states
  const [hasRequested, setHasRequested] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 6-digit segmented inputs
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 5-minute countdown (300 seconds)
  const [validitySeconds, setValiditySeconds] = useState(300);
  const [isExpired, setIsExpired] = useState(false);

  // 60-second resend cooldown
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Attempt counter
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(5);
  const [isLocked, setIsLocked] = useState(false);

  // Display masked email from props or from send response
  const [activeMaskedEmail, setActiveMaskedEmail] = useState<string>(maskedEmail || "your registered email");

  // Simulation mode states (active when SMTP is not configured in .env)
  const [isSimulated, setIsSimulated] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Synchronize masked email when prop updates
  useEffect(() => {
    if (maskedEmail) {
      setActiveMaskedEmail(maskedEmail);
    }
  }, [maskedEmail]);

  // Timer 1: 5-minute OTP validity timer
  useEffect(() => {
    if (!hasRequested || isVerified || validitySeconds <= 0) {
      if (hasRequested && validitySeconds <= 0) {
        setIsExpired(true);
        setErrorMessage("Verification code expired after 5 minutes. Please request a new code.");
      }
      return;
    }

    const interval = setInterval(() => {
      setValiditySeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsExpired(true);
          setErrorMessage("Verification code expired after 5 minutes. Please request a new code.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [hasRequested, isVerified, validitySeconds]);

  // Timer 2: 60-second resend cooldown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const interval = setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  // Request new OTP
  const handleSendOtp = async () => {
    if (isSending || cooldownSeconds > 0 || disabled) return;
    setIsSending(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setIsExpired(false);

    try {
      const res = await fetch("/api/share/download/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: linkId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch verification code.");
      }

      setHasRequested(true);
      setIsSimulated(!!data.simulated);
      setDevCode(data.devCode || null);
      if (data.maskedEmail) {
        setActiveMaskedEmail(data.maskedEmail);
      }
      setStatusMessage(data.message || "A verification code has been sent to your registered email address.");
      setValiditySeconds(data.validitySeconds || 300);
      setCooldownSeconds(data.resendCooldown || 60);
      setDigits(["", "", "", "", "", ""]);
      setRemainingAttempts(5);
      setIsLocked(false);

      // Focus first input field
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSending(false);
    }
  };

  // Handle digit changes with auto-advance
  const handleDigitChange = (index: number, value: string) => {
    if (disabled || isVerified) return;

    // Handle paste of 6-digit code
    if (value.length > 1) {
      const pasted = value.replace(/\D/g, "").slice(0, 6);
      if (pasted.length > 0) {
        const nextDigits = [...digits];
        for (let i = 0; i < 6; i++) {
          nextDigits[i] = pasted[i] || "";
        }
        setDigits(nextDigits);
        const nextIndex = Math.min(pasted.length, 5);
        inputRefs.current[nextIndex]?.focus();
      }
      return;
    }

    const cleanChar = value.replace(/\D/g, "");
    const nextDigits = [...digits];
    nextDigits[index] = cleanChar;
    setDigits(nextDigits);

    // Auto focus next input
    if (cleanChar && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // Handle backspace navigation
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Verify submitted OTP
  const handleVerifyOtp = async () => {
    const fullCode = digits.join("");
    if (fullCode.length !== 6) {
      setErrorMessage("Please enter all 6 digits of the verification code.");
      return;
    }

    if (isExpired) {
      setErrorMessage("Verification code expired after 5 minutes. Please request a new code.");
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/share/download/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: linkId,
          otpCode: fullCode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Parse remaining attempts from error message if available
        const errMsg = data.error || "Verification failed.";
        if (errMsg.includes("attempt(s) remaining")) {
          const match = errMsg.match(/(\d+)\s+attempt/);
          if (match && match[1]) {
            setRemainingAttempts(parseInt(match[1], 10));
          }
        } else if (errMsg.includes("Maximum verification attempts reached")) {
          setRemainingAttempts(0);
          setIsLocked(true);
        }
        throw new Error(errMsg);
      }

      setStatusMessage("Email identity verified! Download access authorized.");
      if (data.sessionToken) {
        onVerified(data.sessionToken);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  // Format mm:ss
  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  // Timer color indicator
  const getTimerColor = (sec: number) => {
    if (sec > 120) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (sec > 45) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    return "text-rose-400 bg-rose-500/10 border-rose-500/20 animate-pulse";
  };

  if (isVerified) {
    return (
      <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs space-y-2">
        <div className="flex items-center gap-2 font-bold">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span>Email Identity Verified • Download Authorized</span>
        </div>
        <p className="text-[11px] text-emerald-300/80 leading-relaxed">
          One-Time Passcode validated. Ephemeral download session established for {activeMaskedEmail}.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-cyber-dark/80 border border-border-primary space-y-4 font-mono">
      {/* Header with masked email info */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-text-primary">Email OTP Verification</div>
            <div className="text-[10px] text-text-secondary mt-0.5">
              Code will be delivered to: <span className="text-indigo-400 font-bold">{activeMaskedEmail}</span>
            </div>
          </div>
        </div>

        {hasRequested && !isExpired && (
          <div className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 shrink-0 ${getTimerColor(validitySeconds)}`}>
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTimer(validitySeconds)}</span>
          </div>
        )}
      </div>

      {/* Status Messages */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-start gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{statusMessage}</span>
          </motion.div>
        )}

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl flex items-start gap-2"
          >
            <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!hasRequested ? (
        /* Initial Action: Send OTP Button */
        <button
          type="button"
          onClick={handleSendOtp}
          disabled={isSending || disabled}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-600/10"
        >
          {isSending ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Generating Secure Code...</span>
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4" />
              <span>Send OTP to {activeMaskedEmail}</span>
            </>
          )}
        </button>
      ) : (
        /* OTP Verification Form */
        <div className="space-y-4 pt-1">
          {/* Simulation mode helper banner (displayed when SMTP is not configured in .env) */}
          {isSimulated && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl space-y-1.5 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>Simulated Mode (SMTP Server Not Configured)</span>
              </div>
              <p className="text-[10px] text-text-secondary leading-normal">
                No SMTP credentials are configured in <code className="text-amber-300">.env</code>. Real emails require SMTP settings (Gmail App Password, Brevo, Resend, etc.).
              </p>
              {devCode && (
                <div className="flex items-center justify-between p-2 bg-cyber-dark rounded border border-border-primary mt-1">
                  <span className="text-[10px] text-text-secondary">Simulated Test OTP:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const arr = devCode.split("");
                      setDigits(arr);
                    }}
                    className="text-xs text-amber-400 font-bold bg-amber-500/15 hover:bg-amber-500/25 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    {devCode} (Click to Fill)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Segmented 6-digit Inputs */}
          <div>
            <div className="flex items-center justify-between mb-2 text-[10px] text-text-secondary">
              <span>Enter 6-Digit Code</span>
              {remainingAttempts !== null && (
                <span className={remainingAttempts <= 2 ? "text-rose-400 font-bold" : "text-text-secondary"}>
                  {remainingAttempts} attempt(s) remaining
                </span>
              )}
            </div>

            <div className="flex justify-between gap-2">
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  disabled={disabled || isLocked || isExpired}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  className={`w-11 h-12 text-center text-lg font-bold font-mono rounded-xl bg-cyber-card border transition-all outline-none ${
                    digit
                      ? "border-indigo-500 text-indigo-400 shadow-sm shadow-indigo-500/20"
                      : "border-border-primary text-text-primary focus:border-indigo-500/70"
                  } disabled:opacity-50`}
                />
              ))}
            </div>
          </div>

          {/* Action Buttons: Verify & Resend */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={isVerifying || disabled || isLocked || isExpired || digits.join("").length !== 6}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 text-white font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verify OTP</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSendOtp}
              disabled={cooldownSeconds > 0 || isSending || disabled}
              className="px-4 py-2.5 rounded-xl border border-border-primary hover:border-indigo-500/50 bg-cyber-card text-text-secondary hover:text-text-primary text-xs font-mono transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSending ? "animate-spin" : ""}`} />
              <span>{cooldownSeconds > 0 ? `Resend in ${cooldownSeconds}s` : "Resend OTP"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
