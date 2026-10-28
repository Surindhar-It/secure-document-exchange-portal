"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  Download, Lock, Unlock, HardDrive, AlertTriangle, CheckCircle2,
  AlertOctagon, Globe, ChevronDown, Search, XCircle, ShieldCheck, Mail
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { decryptFileBuffer, computeSHA256Buffer } from "@/lib/crypto";
import EmailOtpVerificationCard from "@/components/EmailOtpVerificationCard";

// Full ISO 3166-1 alpha-2 country list
const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "AF", name: "Afghanistan", flag: "🇦🇫" },
  { code: "AL", name: "Albania", flag: "🇦🇱" },
  { code: "DZ", name: "Algeria", flag: "🇩🇿" },
  { code: "AD", name: "Andorra", flag: "🇦🇩" },
  { code: "AO", name: "Angola", flag: "🇦🇴" },
  { code: "AG", name: "Antigua and Barbuda", flag: "🇦🇬" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "AM", name: "Armenia", flag: "🇦🇲" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "AZ", name: "Azerbaijan", flag: "🇦🇿" },
  { code: "BS", name: "Bahamas", flag: "🇧🇸" },
  { code: "BH", name: "Bahrain", flag: "🇧🇭" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "BB", name: "Barbados", flag: "🇧🇧" },
  { code: "BY", name: "Belarus", flag: "🇧🇾" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "BZ", name: "Belize", flag: "🇧🇿" },
  { code: "BJ", name: "Benin", flag: "🇧🇯" },
  { code: "BT", name: "Bhutan", flag: "🇧🇹" },
  { code: "BO", name: "Bolivia", flag: "🇧🇴" },
  { code: "BA", name: "Bosnia and Herzegovina", flag: "🇧🇦" },
  { code: "BW", name: "Botswana", flag: "🇧🇼" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "BN", name: "Brunei", flag: "🇧🇳" },
  { code: "BG", name: "Bulgaria", flag: "🇧🇬" },
  { code: "BF", name: "Burkina Faso", flag: "🇧🇫" },
  { code: "BI", name: "Burundi", flag: "🇧🇮" },
  { code: "CV", name: "Cabo Verde", flag: "🇨🇻" },
  { code: "KH", name: "Cambodia", flag: "🇰🇭" },
  { code: "CM", name: "Cameroon", flag: "🇨🇲" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "CF", name: "Central African Republic", flag: "🇨🇫" },
  { code: "TD", name: "Chad", flag: "🇹🇩" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "KM", name: "Comoros", flag: "🇰🇲" },
  { code: "CG", name: "Congo", flag: "🇨🇬" },
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "HR", name: "Croatia", flag: "🇭🇷" },
  { code: "CU", name: "Cuba", flag: "🇨🇺" },
  { code: "CY", name: "Cyprus", flag: "🇨🇾" },
  { code: "CZ", name: "Czech Republic", flag: "🇨🇿" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "DJ", name: "Djibouti", flag: "🇩🇯" },
  { code: "DM", name: "Dominica", flag: "🇩🇲" },
  { code: "DO", name: "Dominican Republic", flag: "🇩🇴" },
  { code: "EC", name: "Ecuador", flag: "🇪🇨" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "SV", name: "El Salvador", flag: "🇸🇻" },
  { code: "GQ", name: "Equatorial Guinea", flag: "🇬🇶" },
  { code: "ER", name: "Eritrea", flag: "🇪🇷" },
  { code: "EE", name: "Estonia", flag: "🇪🇪" },
  { code: "SZ", name: "Eswatini", flag: "🇸🇿" },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹" },
  { code: "FJ", name: "Fiji", flag: "🇫🇯" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "GA", name: "Gabon", flag: "🇬🇦" },
  { code: "GM", name: "Gambia", flag: "🇬🇲" },
  { code: "GE", name: "Georgia", flag: "🇬🇪" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "GR", name: "Greece", flag: "🇬🇷" },
  { code: "GD", name: "Grenada", flag: "🇬🇩" },
  { code: "GT", name: "Guatemala", flag: "🇬🇹" },
  { code: "GN", name: "Guinea", flag: "🇬🇳" },
  { code: "GW", name: "Guinea-Bissau", flag: "🇬🇼" },
  { code: "GY", name: "Guyana", flag: "🇬🇾" },
  { code: "HT", name: "Haiti", flag: "🇭🇹" },
  { code: "HN", name: "Honduras", flag: "🇭🇳" },
  { code: "HU", name: "Hungary", flag: "🇭🇺" },
  { code: "IS", name: "Iceland", flag: "🇮🇸" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "IR", name: "Iran", flag: "🇮🇷" },
  { code: "IQ", name: "Iraq", flag: "🇮🇶" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "IL", name: "Israel", flag: "🇮🇱" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "JM", name: "Jamaica", flag: "🇯🇲" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "JO", name: "Jordan", flag: "🇯🇴" },
  { code: "KZ", name: "Kazakhstan", flag: "🇰🇿" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "KI", name: "Kiribati", flag: "🇰🇮" },
  { code: "KP", name: "North Korea", flag: "🇰🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "KW", name: "Kuwait", flag: "🇰🇼" },
  { code: "KG", name: "Kyrgyzstan", flag: "🇰🇬" },
  { code: "LA", name: "Laos", flag: "🇱🇦" },
  { code: "LV", name: "Latvia", flag: "🇱🇻" },
  { code: "LB", name: "Lebanon", flag: "🇱🇧" },
  { code: "LS", name: "Lesotho", flag: "🇱🇸" },
  { code: "LR", name: "Liberia", flag: "🇱🇷" },
  { code: "LY", name: "Libya", flag: "🇱🇾" },
  { code: "LI", name: "Liechtenstein", flag: "🇱🇮" },
  { code: "LT", name: "Lithuania", flag: "🇱🇹" },
  { code: "LU", name: "Luxembourg", flag: "🇱🇺" },
  { code: "MG", name: "Madagascar", flag: "🇲🇬" },
  { code: "MW", name: "Malawi", flag: "🇲🇼" },
  { code: "MY", name: "Malaysia", flag: "🇲🇾" },
  { code: "MV", name: "Maldives", flag: "🇲🇻" },
  { code: "ML", name: "Mali", flag: "🇲🇱" },
  { code: "MT", name: "Malta", flag: "🇲🇹" },
  { code: "MH", name: "Marshall Islands", flag: "🇲🇭" },
  { code: "MR", name: "Mauritania", flag: "🇲🇷" },
  { code: "MU", name: "Mauritius", flag: "🇲🇺" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "FM", name: "Micronesia", flag: "🇫🇲" },
  { code: "MD", name: "Moldova", flag: "🇲🇩" },
  { code: "MC", name: "Monaco", flag: "🇲🇨" },
  { code: "MN", name: "Mongolia", flag: "🇲🇳" },
  { code: "ME", name: "Montenegro", flag: "🇲🇪" },
  { code: "MA", name: "Morocco", flag: "🇲🇦" },
  { code: "MZ", name: "Mozambique", flag: "🇲🇿" },
  { code: "MM", name: "Myanmar", flag: "🇲🇲" },
  { code: "NA", name: "Namibia", flag: "🇳🇦" },
  { code: "NR", name: "Nauru", flag: "🇳🇷" },
  { code: "NP", name: "Nepal", flag: "🇳🇵" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿" },
  { code: "NI", name: "Nicaragua", flag: "🇳🇮" },
  { code: "NE", name: "Niger", flag: "🇳🇪" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "MK", name: "North Macedonia", flag: "🇲🇰" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "OM", name: "Oman", flag: "🇴🇲" },
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "PW", name: "Palau", flag: "🇵🇼" },
  { code: "PA", name: "Panama", flag: "🇵🇦" },
  { code: "PG", name: "Papua New Guinea", flag: "🇵🇬" },
  { code: "PY", name: "Paraguay", flag: "🇵🇾" },
  { code: "PE", name: "Peru", flag: "🇵🇪" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "QA", name: "Qatar", flag: "🇶🇦" },
  { code: "RO", name: "Romania", flag: "🇷🇴" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "RW", name: "Rwanda", flag: "🇷🇼" },
  { code: "KN", name: "Saint Kitts and Nevis", flag: "🇰🇳" },
  { code: "LC", name: "Saint Lucia", flag: "🇱🇨" },
  { code: "VC", name: "Saint Vincent and the Grenadines", flag: "🇻🇨" },
  { code: "WS", name: "Samoa", flag: "🇼🇸" },
  { code: "SM", name: "San Marino", flag: "🇸🇲" },
  { code: "ST", name: "São Tomé and Príncipe", flag: "🇸🇹" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "SN", name: "Senegal", flag: "🇸🇳" },
  { code: "RS", name: "Serbia", flag: "🇷🇸" },
  { code: "SC", name: "Seychelles", flag: "🇸🇨" },
  { code: "SL", name: "Sierra Leone", flag: "🇸🇱" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "SK", name: "Slovakia", flag: "🇸🇰" },
  { code: "SI", name: "Slovenia", flag: "🇸🇮" },
  { code: "SB", name: "Solomon Islands", flag: "🇸🇧" },
  { code: "SO", name: "Somalia", flag: "🇸🇴" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "SS", name: "South Sudan", flag: "🇸🇸" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "SD", name: "Sudan", flag: "🇸🇩" },
  { code: "SR", name: "Suriname", flag: "🇸🇷" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "SY", name: "Syria", flag: "🇸🇾" },
  { code: "TW", name: "Taiwan", flag: "🇹🇼" },
  { code: "TJ", name: "Tajikistan", flag: "🇹🇯" },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿" },
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "TL", name: "Timor-Leste", flag: "🇹🇱" },
  { code: "TG", name: "Togo", flag: "🇹🇬" },
  { code: "TO", name: "Tonga", flag: "🇹🇴" },
  { code: "TT", name: "Trinidad and Tobago", flag: "🇹🇹" },
  { code: "TN", name: "Tunisia", flag: "🇹🇳" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "TM", name: "Turkmenistan", flag: "🇹🇲" },
  { code: "TV", name: "Tuvalu", flag: "🇹🇻" },
  { code: "UG", name: "Uganda", flag: "🇺🇬" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "UY", name: "Uruguay", flag: "🇺🇾" },
  { code: "UZ", name: "Uzbekistan", flag: "🇺🇿" },
  { code: "VU", name: "Vanuatu", flag: "🇻🇺" },
  { code: "VE", name: "Venezuela", flag: "🇻🇪" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "YE", name: "Yemen", flag: "🇾🇪" },
  { code: "ZM", name: "Zambia", flag: "🇿🇲" },
  { code: "ZW", name: "Zimbabwe", flag: "🇿🇼" },
];

export default function DownloadPortalPage() {
  const params = useParams();
  const linkId = params.id as string;

  // Key extracted from window.location.hash
  const [hexKey, setHexKey] = useState("");

  // Phase tracking: "country-select" | "loading" | "ready" | "error"
  const [phase, setPhase] = useState<"country-select" | "loading" | "ready" | "error">("loading");
  const [hasGeoRestriction, setHasGeoRestriction] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Transfer Mode & Blockchain details
  const [transferMode, setTransferMode] = useState<"STANDARD" | "BLOCKCHAIN">("STANDARD");
  const [blockchainProof, setBlockchainProof] = useState<any | null>(null);

  // Recipient binding details
  const [hasRecipientBinding, setHasRecipientBinding] = useState(false);
  const [claimedEmailInput, setClaimedEmailInput] = useState("");

  // Link metadata details
  const [authMethod, setAuthMethod] = useState<"NONE" | "PASSWORD" | "EMAIL_OTP" | "BOTH">("NONE");
  const [maskedRecipientEmail, setMaskedRecipientEmail] = useState<string | null>(null);
  const [otpSessionToken, setOtpSessionToken] = useState<string | null>(null);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [fileNameEnc, setFileNameEnc] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [mimeType, setMimeType] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [watermarkText, setWatermarkText] = useState("");

  // Country selection state
  const [selectedCountry, setSelectedCountry] = useState<{ code: string; name: string; flag: string } | null>(null);
  const [countrySearch, setCountrySearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // User input states
  const [passwordInput, setPasswordInput] = useState("");
  const [otpInput, setOtpInput] = useState("");

  // Simulated OTP states
  const [simulatedOtp, setSimulatedOtp] = useState("");
  const [simulatedOtpInfo, setSimulatedOtpInfo] = useState("");

  // Multi-file bundle state (up to 20 files per link)
  const [filesList, setFilesList] = useState<any[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Dual-Layer Integrity verification state (Encrypted Ciphertext Check & Decrypted Plaintext Check)
  const [computedCiphertextHash, setComputedCiphertextHash] = useState<string | null>(null);
  const [expectedCiphertextHash, setExpectedCiphertextHash] = useState<string | null>(null);
  const [ciphertextVerified, setCiphertextVerified] = useState<boolean | null>(null);

  const [computedPlaintextHash, setComputedPlaintextHash] = useState<string | null>(null);
  const [expectedPlaintextHash, setExpectedPlaintextHash] = useState<string | null>(null);
  const [plaintextVerified, setPlaintextVerified] = useState<boolean | null>(null);

  // Decryption progress state
  const [decryptProgress, setDecryptProgress] = useState(0);
  const [decryptStatus, setDecryptStatus] = useState("");
  const [decryptStep, setDecryptStep] = useState(0);

  // Filtered countries by search query
  const filteredCountries = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  useEffect(() => {
    // Extract key from hash fragment
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash && hash.startsWith("#")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHexKey(hash.substring(1));
      }
    }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Initial load: fetch link meta without geo to discover if geo restriction applies
  async function fetchInitialMeta() {
    setPhase("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/share/download?id=${linkId}`);
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Failed to load download portal.");
        setPhase("error");
        return;
      }

      setTransferMode(data.transferMode || "STANDARD");
      setBlockchainProof(data.blockchainProof || null);
      setHasRecipientBinding(!!data.hasRecipientBinding);
      if (data.authMethod) setAuthMethod(data.authMethod);
      if (data.maskedRecipientEmail) setMaskedRecipientEmail(data.maskedRecipientEmail);

      const resolvedFiles = data.files && data.files.length > 0 ? data.files : (data.file ? [data.file] : []);
      setFilesList(resolvedFiles);
      if (resolvedFiles.length > 0) {
        setSelectedFileId(resolvedFiles[0].id);
      }

      if (data.hasGeoRestriction) {
        setHasGeoRestriction(true);
        setPhase("country-select");
      } else {
        const primary = resolvedFiles[0] || data.file;
        setFileNameEnc(primary?.fileName || "");
        setFileSize(primary?.fileSize || null);
        setMimeType(primary?.mimeType || "");
        setPasswordRequired(data.passwordRequired);
        setOtpRequired(data.otpRequired);
        setWatermarkText(data.watermarkText || "");
        setPhase("ready");
      }
    } catch {
      setErrorMsg("Failed to connect to share node. Check your connection and retry.");
      setPhase("error");
    }
  }

  useEffect(() => {
    if (linkId) {
      fetchInitialMeta();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  // Called after user selects their country and confirms
  async function handleCountryConfirm() {
    if (!selectedCountry) return;
    setPhase("loading");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/share/download?id=${linkId}&geo=${selectedCountry.code}`);
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Access denied for your selected location.");
        setPhase("country-select");
        return;
      }

      setTransferMode(data.transferMode || "STANDARD");
      setBlockchainProof(data.blockchainProof || null);
      setHasRecipientBinding(!!data.hasRecipientBinding);
      if (data.authMethod) setAuthMethod(data.authMethod);
      if (data.maskedRecipientEmail) setMaskedRecipientEmail(data.maskedRecipientEmail);

      const resolvedFiles = data.files && data.files.length > 0 ? data.files : (data.file ? [data.file] : []);
      setFilesList(resolvedFiles);
      if (resolvedFiles.length > 0) {
        setSelectedFileId(resolvedFiles[0].id);
      }

      const primary = resolvedFiles[0] || data.file;
      setFileNameEnc(primary?.fileName || "");
      setFileSize(primary?.fileSize || null);
      setMimeType(primary?.mimeType || "");
      setPasswordRequired(data.passwordRequired);
      setOtpRequired(data.otpRequired);
      setWatermarkText(data.watermarkText || "");
      setPhase("ready");
    } catch {
      setErrorMsg("Network error while verifying your location. Please retry.");
      setPhase("country-select");
    }
  }

  // Request OTP passcode
  const handleRequestOtp = async () => {
    setSimulatedOtp("");
    setSimulatedOtpInfo("");
    try {
      const res = await fetch("/api/share/download/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: linkId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSimulatedOtp(data.otpCode);
      setSimulatedOtpInfo(data.message);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to request verification code.");
    }
  };

  // Helper to execute download and verify dual-hashes (ciphertext & plaintext)
  const executeDownloadAndVerify = async (targetFileId?: string) => {
    setDecryptStep(1);
    setDecryptProgress(15);
    setDecryptStatus("Verifying policy criteria with AccessPolicyEngine...");

    setDecryptStep(2);
    setDecryptProgress(35);
    setDecryptStatus("Atomic download authorization confirmed. Streaming ciphertext blocks...");

    const res = await fetch("/api/share/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: linkId,
        fileId: targetFileId || selectedFileId || undefined,
        password: passwordInput || null,
        otpCode: otpInput || null,
        sessionToken: otpSessionToken || null,
        geo: selectedCountry?.code || "XX",
        email: claimedEmailInput || null,
      }),
    });

    const contentType = res.headers.get("Content-Type");
    if (!res.ok || contentType?.includes("application/json")) {
      const errorData = await res.json();
      throw new Error(errorData.error || "Access validation denied by server policy");
    }

    // Read KMS-released key and hashes from authorized response headers
    const kmsReleasedKey = res.headers.get("x-payload-key");
    const expectedCipherHash = res.headers.get("x-ciphertext-hash");
    const expectedOrigHash = res.headers.get("x-original-hash");
    const headerFileName = res.headers.get("x-file-name");
    const activeDecryptionKey = kmsReleasedKey || hexKey;

    if (!activeDecryptionKey) {
      throw new Error("Decryption key missing. Provide key token or ensure KMS envelope is configured.");
    }

    const combinedBuffer = await res.arrayBuffer();

    // STEP 1: VERIFY ENCRYPTED VALUE (CIPHERTEXT INTEGRITY CHECK)
    setDecryptProgress(55);
    setDecryptStatus("Step 1/2: Cryptographically verifying encrypted ciphertext hash (checking for storage/transit tampering)...");
    const computedCipher = await computeSHA256Buffer(combinedBuffer);
    setComputedCiphertextHash(computedCipher);
    setExpectedCiphertextHash(expectedCipherHash);

    if (expectedCipherHash && expectedCipherHash.toLowerCase() !== computedCipher.toLowerCase()) {
      setCiphertextVerified(false);
      throw new Error(
        `CRITICAL TAMPER DETECTED: Ciphertext SHA-256 hash does not match stored signature!\n` +
        `Computed: ${computedCipher}\n` +
        `Expected: ${expectedCipherHash}\n` +
        `Encrypted payload was altered or corrupted in storage. Halting decryption.`
      );
    }
    setCiphertextVerified(true);

    // STEP 2: DECRYPT WITH WEB CRYPTO (AES-256-GCM)
    setDecryptProgress(75);
    setDecryptStatus(
      transferMode === "BLOCKCHAIN"
        ? "Ciphertext verified untampered. Decrypting payload locally with Web Crypto (AES-256-GCM)..."
        : "Ciphertext verified untampered. Decrypting payload locally with Web Crypto (AES-256-GCM)..."
    );
    setDecryptStep(3);

    const plaintextBuffer = await decryptFileBuffer(combinedBuffer, activeDecryptionKey);

    // STEP 3: VERIFY DECRYPTED VALUE (PLAINTEXT INTEGRITY CHECK)
    setDecryptProgress(90);
    setDecryptStatus("Step 2/2: Verifying SHA-256 decrypted content against original upload signature...");
    const computedPlain = await computeSHA256Buffer(plaintextBuffer);
    setComputedPlaintextHash(computedPlain);
    setExpectedPlaintextHash(expectedOrigHash);

    if (expectedOrigHash && expectedOrigHash.toLowerCase() !== computedPlain.toLowerCase()) {
      setPlaintextVerified(false);
      throw new Error(
        `CRITICAL INTEGRITY MISMATCH: Decrypted document hash does not match original unencrypted document!\n` +
        `Computed: ${computedPlain}\n` +
        `Expected: ${expectedOrigHash}\n` +
        `Document display halted due to integrity mismatch.`
      );
    }
    setPlaintextVerified(true);

    await new Promise((r) => setTimeout(r, 400));

    // Resolve file name
    const currentFile = filesList.find((f) => f.id === (targetFileId || selectedFileId)) || filesList[0];
    let originalName = "decrypted_file";
    const encName = headerFileName || currentFile?.fileName || fileNameEnc;
    if (encName) {
      try {
        originalName = window.atob(encName);
      } catch {
        originalName = encName;
      }
    }

    setDecryptProgress(100);
    setDecryptStatus("Zero-Tampering Confirmed: Encrypted ciphertext and decrypted original plaintext both verified untampered!");
    setDecryptStep(4);

    const blob = new Blob([plaintextBuffer], { type: currentFile?.mimeType || mimeType });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.setAttribute("download", originalName);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);
  };

  // Download & decrypt single or active file
  const handleDownloadAndDecrypt = async (e?: React.FormEvent, targetFileId?: string) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const requiresOtp = authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired;
    if (requiresOtp && !isOtpVerified) {
      setErrorMsg("Please complete Email OTP verification to unlock document access.");
      return;
    }

    if (hasRecipientBinding && !requiresOtp && !claimedEmailInput) {
      setErrorMsg("Please enter your designated recipient email address to proceed.");
      return;
    }

    try {
      await executeDownloadAndVerify(targetFileId);
    } catch (err) {
      console.error(err);
      setDecryptStep(0);
      setDecryptProgress(0);
      setDecryptStatus("");
      setErrorMsg(err instanceof Error ? err.message : "Decryption failed. Ensure the key fragment is correct and unchanged.");
    }
  };

  // Download and verify all files in bundle sequentially
  const handleDownloadAllBundleFiles = async () => {
    if (!filesList.length) return;
    setErrorMsg("");

    const requiresOtp = authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired;
    if (requiresOtp && !isOtpVerified) {
      setErrorMsg("Please complete Email OTP verification to unlock document access.");
      return;
    }

    if (hasRecipientBinding && !requiresOtp && !claimedEmailInput) {
      setErrorMsg("Please enter your designated recipient email address to proceed.");
      return;
    }

    try {
      for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        setSelectedFileId(file.id);
        setDecryptStatus(`Recovering and verifying file ${i + 1} of ${filesList.length}...`);
        await executeDownloadAndVerify(file.id);
        await new Promise((r) => setTimeout(r, 600));
      }
      setDecryptStatus(`All ${filesList.length} files successfully verified and downloaded.`);
    } catch (err) {
      console.error(err);
      setDecryptStep(0);
      setDecryptProgress(0);
      setDecryptStatus("");
      setErrorMsg(err instanceof Error ? err.message : "Batch download failed.");
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex-grow flex items-center justify-center px-4 py-20 relative z-10 select-none">
      {/* Background watermark */}
      {watermarkText && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] select-none overflow-hidden">
          <div className="text-text-primary text-5xl sm:text-7xl font-extrabold uppercase rotate-12 tracking-widest whitespace-nowrap">
            {watermarkText} • {watermarkText}
          </div>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md glass-panel rounded-2xl p-8 glow-indigo relative overflow-hidden"
      >
        {/* Top brand */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-primary-indigo to-primary-purple flex items-center justify-center glow-indigo mb-3">
            <Unlock className="w-6 h-6 text-text-primary animate-pulse" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-text-primary">SecureDocX Exchange Portal</h2>
          <p className="text-[9px] text-text-secondary font-mono mt-0.5 uppercase tracking-wider">Zero-Knowledge Key Verify</p>

          {/* Transfer Mode Indicator Badge */}
          <div className="mt-3">
            {transferMode === "BLOCKCHAIN" ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>BLOCKCHAIN TRANSFER (ON-CHAIN VERIFIED)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-mono font-bold">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                <span>STANDARD TRANSFER (AES-256-GCM)</span>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs flex gap-2.5 items-start mb-5 font-mono">
            <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        {/* === LOADING STATE === */}
        {phase === "loading" && (
          <div className="flex flex-col items-center justify-center font-mono py-8 space-y-3">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-indigo-400">CONNECTING NODE METADATA...</span>
          </div>
        )}

        {/* === ERROR STATE === */}
        {phase === "error" && (
          <div className="space-y-4 text-center">
            <p className="text-xs text-text-secondary leading-relaxed font-mono">
              The requested link cannot be loaded. Ensure the parameters are active or request a fresh key bridge from the owner.
            </p>
            <button
              onClick={fetchInitialMeta}
              className="w-full py-2.5 border border-border-primary bg-cyber-card hover:bg-cyber-dark text-text-primary font-mono text-xs rounded-xl transition-all cursor-pointer"
            >
              Retry Node Verification
            </button>
          </div>
        )}

        {/* === COUNTRY SELECTION STATE === */}
        {phase === "country-select" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-5"
          >
            {/* Geo restriction notice */}
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-2.5 items-start">
              <Globe className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-mono text-amber-400 font-bold">Geographic Access Policy Active</p>
                <p className="text-[10px] text-text-secondary font-mono mt-0.5 leading-relaxed">
                  This document transfer enforces geographical boundary rules. Confirm your location to authenticate.
                </p>
              </div>
            </div>

            {/* Country searchable dropdown */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-widest">
                Select Your Country
              </label>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen((v) => !v);
                    setCountrySearch("");
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-cyber-dark border border-border-primary hover:border-indigo-500/50 text-sm font-mono flex items-center justify-between gap-2 transition-all cursor-pointer"
                >
                  {selectedCountry ? (
                    <span className="flex items-center gap-2 text-text-primary">
                      <span className="text-base">{selectedCountry.flag}</span>
                      <span>{selectedCountry.name}</span>
                      <span className="text-text-secondary text-[10px] ml-1">({selectedCountry.code})</span>
                    </span>
                  ) : (
                    <span className="text-text-secondary text-xs">Choose your country...</span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {dropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-50 mt-1 w-full bg-cyber-card border border-border-primary rounded-xl overflow-hidden shadow-2xl"
                    >
                      <div className="p-2 border-b border-border-primary flex items-center gap-2 bg-cyber-dark">
                        <Search className="w-3.5 h-3.5 text-text-secondary flex-shrink-0" />
                        <input
                          type="text"
                          autoFocus
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          placeholder="Search country or code..."
                          className="flex-1 bg-transparent text-xs font-mono text-text-primary outline-none placeholder:text-text-secondary"
                        />
                        {countrySearch && (
                          <button onClick={() => setCountrySearch("")} className="text-text-secondary hover:text-text-primary cursor-pointer">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="max-h-52 overflow-y-auto">
                        {filteredCountries.length === 0 ? (
                          <div className="py-6 text-center text-[11px] font-mono text-text-secondary">No countries match your search</div>
                        ) : (
                          filteredCountries.map((country) => (
                            <button
                              key={country.code}
                              type="button"
                              onClick={() => {
                                setSelectedCountry(country);
                                setDropdownOpen(false);
                                setErrorMsg("");
                              }}
                              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 text-xs font-mono hover:bg-indigo-600/10 transition-colors cursor-pointer ${
                                selectedCountry?.code === country.code
                                  ? "bg-indigo-600/15 text-indigo-400"
                                  : "text-text-primary"
                              }`}
                            >
                              <span className="text-base w-6 text-center">{country.flag}</span>
                              <span className="flex-1">{country.name}</span>
                              <span className="text-text-secondary text-[10px]">{country.code}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <button
              type="button"
              disabled={!selectedCountry}
              onClick={handleCountryConfirm}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-xs font-mono flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-500/5 transition-all"
            >
              <Globe className="w-4 h-4" />
              {selectedCountry
                ? `Verify Access from ${selectedCountry.name} ${selectedCountry.flag}`
                : "Select a Country to Continue"}
            </button>
          </motion.div>
        )}

        {/* === READY STATE: Download form === */}
        {phase === "ready" && (
          <form onSubmit={handleDownloadAndDecrypt} className="space-y-5">
            {/* Country badge (if geo restricted) */}
            {hasGeoRestriction && selectedCountry && (
              <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="text-[10px] font-mono text-emerald-400">
                  Location verified: {selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPhase("country-select");
                    setErrorMsg("");
                  }}
                  className="ml-auto text-[9px] font-mono text-text-secondary hover:text-indigo-400 underline cursor-pointer"
                >
                  Change
                </button>
              </div>
            )}

            {/* Blockchain Proof Badge (if blockchain mode) */}
            {transferMode === "BLOCKCHAIN" && blockchainProof && (
              <div className="p-3 bg-cyber-dark border border-emerald-500/20 rounded-xl space-y-1 font-mono text-[10px]">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> On-Chain Integrity Proof
                  </span>
                  <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded uppercase font-bold">
                    {blockchainProof.status || "CONFIRMED"}
                  </span>
                </div>
                <div className="text-text-secondary truncate">
                  Proof ID: <span className="text-text-primary select-all">{blockchainProof.proofId}</span>
                </div>
                <div className="text-text-secondary truncate">
                  Network: <span className="text-cyan-400 uppercase">{blockchainProof.network}</span>
                </div>
              </div>
            )}

            {/* Multi-File Bundle Document List (when bundle contains multiple documents) */}
            {filesList.length > 1 ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-widest">
                    Transfer Bundle ({filesList.length} Documents, Max 20)
                  </label>
                  <button
                    type="button"
                    onClick={handleDownloadAllBundleFiles}
                    disabled={decryptStep > 0 && decryptStep < 4}
                    className="text-[9px] font-mono text-indigo-400 hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    Download All
                  </button>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {filesList.map((file, idx) => {
                    let dName = `document_${idx + 1}.bin`;
                    try {
                      dName = window.atob(file.fileName);
                    } catch {
                      dName = file.fileName;
                    }
                    const isSelected = (selectedFileId || filesList[0]?.id) === file.id;

                    return (
                      <div
                        key={file.id}
                        onClick={() => setSelectedFileId(file.id)}
                        className={`p-2.5 rounded-xl border font-mono text-xs cursor-pointer transition-all flex items-center justify-between gap-2.5 ${
                          isSelected
                            ? "bg-indigo-600/15 border-indigo-500 text-text-primary"
                            : "bg-cyber-dark/80 border-border-primary text-text-secondary hover:border-indigo-500/30"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <HardDrive className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-indigo-400" : "text-text-secondary"}`} />
                          <div className="truncate">
                            <span className="font-bold text-text-primary block truncate max-w-[190px]">{dName}</span>
                            <span className="text-[9px] text-text-secondary">{formatBytes(file.fileSize)}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFileId(file.id);
                            handleDownloadAndDecrypt(undefined, file.id);
                          }}
                          disabled={decryptStep > 0 && decryptStep < 4}
                          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-bold cursor-pointer shrink-0"
                        >
                          Recover
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Single File Info Card */
              <div className="p-4 bg-cyber-dark/70 border border-border-primary rounded-xl flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div className="space-y-1 font-mono text-xs truncate">
                  <div className="font-bold text-text-primary truncate max-w-[240px]">
                    {fileNameEnc
                      ? (() => {
                          try { return window.atob(fileNameEnc); } catch { return "payload.enc"; }
                        })()
                      : "encrypted_payload.enc"}
                  </div>
                  <div className="text-text-secondary text-[10px]">{formatBytes(fileSize)}</div>
                </div>
              </div>
            )}

            {/* Recipient Binding Identity Challenge (only if not using Email OTP) */}
            {hasRecipientBinding && !(authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired) && (
              <div className="space-y-2">
                <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-widest flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-400" /> Recipient Verification (Bound Transfer)
                </label>
                <input
                  type="email"
                  value={claimedEmailInput}
                  onChange={(e) => setClaimedEmailInput(e.target.value)}
                  required
                  placeholder="Enter your designated email address"
                  className="w-full px-3 py-2.5 rounded-xl bg-cyber-dark border border-border-primary focus:border-indigo-500/50 text-xs font-mono text-text-primary outline-none"
                />
              </div>
            )}

            {/* Email OTP Verification System Card */}
            {(authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired) && (
              <EmailOtpVerificationCard
                linkId={linkId}
                maskedEmail={maskedRecipientEmail}
                isVerified={isOtpVerified}
                onVerified={(token) => {
                  setOtpSessionToken(token);
                  setIsOtpVerified(true);
                  setErrorMsg("");
                }}
                disabled={decryptStep > 0 && decryptStep < 4}
              />
            )}

            {/* Password input */}
            {(passwordRequired || authMethod === "PASSWORD" || authMethod === "BOTH") && (
              <div className="space-y-2">
                <label className="block text-[10px] font-mono text-text-secondary uppercase tracking-widest">Access Password Required</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-text-secondary" />
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    required
                    placeholder="Enter link password"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-cyber-dark border border-border-primary focus:border-indigo-500/50 text-xs font-mono text-text-primary outline-none"
                  />
                </div>
              </div>
            )}

            {/* Key indicator */}
            <div className="p-3 bg-cyber-dark border border-border-primary rounded-xl flex items-center justify-between text-[11px] font-mono">
              <span className="text-text-secondary">URL Hash Decryption Token:</span>
              {hexKey ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Present
                </span>
              ) : (
                <span className="text-rose-500 font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 animate-pulse" /> Missing Key
                </span>
              )}
            </div>

            {/* Dual Integrity Verification Status & Progress HUD */}
            {decryptStep > 0 && (
              <div className="glass-panel p-4 rounded-xl border-indigo-500/25 space-y-3 font-mono text-[10px]">
                <div className="flex justify-between text-text-secondary">
                  <span>STATUS: {decryptStatus}</span>
                  <span>{decryptProgress}%</span>
                </div>
                <div className="w-full bg-cyber-dark h-1.5 rounded-full overflow-hidden border border-border-primary">
                  <div
                    style={{ width: `${decryptProgress}%` }}
                    className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                  />
                </div>

                {/* Dual verification telemetry indicators */}
                <div className="pt-2 border-t border-border-primary/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">1. Encrypted Ciphertext Hash:</span>
                    {ciphertextVerified === true ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> MATCH / UNTAMPERED
                      </span>
                    ) : ciphertextVerified === false ? (
                      <span className="text-rose-400 font-bold flex items-center gap-1">
                        <AlertOctagon className="w-3 h-3" /> MODIFIED
                      </span>
                    ) : (
                      <span className="text-slate-400">PENDING CHECK</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">2. Decrypted Document Hash:</span>
                    {plaintextVerified === true ? (
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> MATCH / ORIGINAL
                      </span>
                    ) : plaintextVerified === false ? (
                      <span className="text-rose-400 font-bold flex items-center gap-1">
                        <AlertOctagon className="w-3 h-3" /> MISMATCH
                      </span>
                    ) : (
                      <span className="text-slate-400">PENDING CHECK</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={(decryptStep > 0 && decryptStep < 4) || ((authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired) && !isOtpVerified)}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-primary-indigo to-primary-purple hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-xs font-mono flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-500/5 transition-all"
            >
              <Download className="w-4 h-4" />
              {((authMethod === "EMAIL_OTP" || authMethod === "BOTH" || otpRequired) && !isOtpVerified)
                ? "Verify Email OTP to Authorize Download"
                : filesList.length > 1
                ? "Download & Verify Selected Document"
                : "Download Cipher & Decrypt Locally"}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
