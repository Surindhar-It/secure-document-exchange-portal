"use client";

import React, { useState, useRef } from "react";
import {
  Image as ImageIcon, Download, Upload, CheckCircle2, AlertTriangle,
  RefreshCw, Lock, Eye, FileText, ArrowRight, ShieldCheck, Sparkles
} from "lucide-react";
import {
  embedPayloadInImageData,
  extractPayloadFromImageData,
  calculateImageCapacity,
} from "@/lib/steganography";

export default function StegoToolView({ files, links }: { files: any[]; links: any[] }) {
  // Mode: "embed" | "extract"
  const [activeMode, setActiveMode] = useState<"embed" | "extract">("embed");

  // Embedding states
  const [coverImage, setCoverImage] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [payloadType, setPayloadType] = useState<"custom" | "share_token">("share_token");
  const [selectedShareLink, setSelectedShareLink] = useState("");
  const [customPayloadText, setCustomPayloadText] = useState("");
  const [embedStatus, setEmbedStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [stegoDownloadUrl, setStegoDownloadUrl] = useState<string | null>(null);

  // Extraction states
  const [extractImage, setExtractImage] = useState<File | null>(null);
  const [extractStatus, setExtractStatus] = useState<{
    success?: boolean;
    message?: string;
    payload?: string;
  } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Handle Cover Image selection
  const handleCoverImageChange = (file: File) => {
    setCoverImage(file);
    setEmbedStatus(null);
    setStegoDownloadUrl(null);

    // Validate format: PNG or BMP (lossless)
    if (!file.type.includes("png") && !file.type.includes("bmp") && !file.name.endsWith(".png")) {
      setEmbedStatus({
        success: false,
        message: "Lossless image format required (PNG or BMP). Lossy formats like JPEG alter pixel values and degrade LSB bits.",
      });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setCoverPreviewUrl(objectUrl);

    const img = new Image();
    img.src = objectUrl;
    img.onload = () => {
      setImageDims({ width: img.width, height: img.height });
    };
  };

  // Execute Embedding
  const handleEmbedPayload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coverImage || !imageDims) return;
    setEmbedStatus(null);
    setStegoDownloadUrl(null);

    try {
      // Determine payload text
      let payloadToEmbed = "";
      if (payloadType === "share_token") {
        if (!selectedShareLink) {
          throw new Error("Please select an active secure transfer to generate its verification token.");
        }
        const linkObj = links.find((l) => l.id === selectedShareLink);
        payloadToEmbed = JSON.stringify({
          type: "SECUREDOCX_STEGO_TOKEN",
          version: "1.0",
          shareId: selectedShareLink,
          mode: linkObj?.transferMode || "STANDARD",
          documentHash: linkObj?.file?.signature || "sha256-hash",
          issuedAt: Date.now(),
        });
      } else {
        if (!customPayloadText.trim()) {
          throw new Error("Payload cannot be empty.");
        }
        payloadToEmbed = customPayloadText.trim();
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(coverImage);
      img.src = objectUrl;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error("Failed to load cover image for canvas rendering."));
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context initialization failed.");

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(objectUrl);

      // Embed payload using LSB
      const result = embedPayloadInImageData(imgData.data, img.width, img.height, payloadToEmbed);
      if (!result.success) {
        throw new Error(result.error || "Failed to embed payload in image.");
      }

      ctx.putImageData(imgData, 0, 0);

      // Convert canvas to PNG blob
      canvas.toBlob((blob) => {
        if (!blob) {
          setEmbedStatus({ success: false, message: "Failed to generate PNG blob." });
          return;
        }
        const stegoUrl = URL.createObjectURL(blob);
        setStegoDownloadUrl(stegoUrl);
        setEmbedStatus({
          success: true,
          message: `Payload successfully embedded (${result.bytesEmbedded} bytes into ${img.width}x${img.height} cover). Ready for download!`,
        });
      }, "image/png");

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setEmbedStatus({ success: false, message: msg });
    }
  };

  // Execute Extraction
  const handleExtractPayload = async (file: File) => {
    setExtractImage(file);
    setExtractStatus(null);
    setIsExtracting(true);

    try {
      if (!file.type.includes("png") && !file.type.includes("bmp") && !file.name.endsWith(".png")) {
        throw new Error("Lossless image format required (PNG or BMP).");
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.src = objectUrl;
      await new Promise((resolve, reject) => {
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error("Failed to decode image file."));
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to initialize canvas context.");

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(objectUrl);

      const result = extractPayloadFromImageData(imgData.data, img.width, img.height);
      if (!result.success || !result.payload) {
        throw new Error(result.error || "No valid steganographic payload found in this image.");
      }

      setExtractStatus({
        success: true,
        message: `Steganography payload successfully extracted! Checksum verified.`,
        payload: result.payload,
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractStatus({ success: false, message: msg });
    } finally {
      setIsExtracting(false);
    }
  };

  const capacity = imageDims ? calculateImageCapacity(imageDims.width, imageDims.height) : 0;

  return (
    <div className="space-y-8 font-mono select-none">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <ImageIcon className="w-4 h-4" />
            <span>LSB Image Steganography Suite</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Image Steganography Carrier Tool
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Embed and extract cryptographic verification tokens and key envelopes inside lossless PNG carriers.
          </p>
        </div>

        {/* Mode Toggle Buttons */}
        <div className="flex p-1 rounded-xl bg-cyber-card border border-border-primary self-start md:self-auto">
          <button
            onClick={() => setActiveMode("embed")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === "embed"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Embed Carrier
          </button>
          <button
            onClick={() => setActiveMode("extract")}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === "extract"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Extract Payload
          </button>
        </div>
      </div>

      {/* Security Notice */}
      <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20 text-[11px] text-text-secondary flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-indigo-300">Security Architecture Note:</strong> Steganography is an optional transport carrier. Possession of the image alone never grants document access. All transfers continue to enforce recipient authentication, passwords, OTP, expiration, and backend risk engine evaluation.
        </p>
      </div>

      {/* Embed Mode */}
      {activeMode === "embed" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Input & Setup */}
          <div className="lg:col-span-7 space-y-6">
            <form onSubmit={handleEmbedPayload} className="space-y-5">
              {/* Cover Image Selection */}
              <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  1. Select Cover Image (Lossless PNG / BMP)
                </h2>

                <div className="p-5 rounded-xl border border-dashed border-border-primary bg-cyber-dark flex flex-col items-center justify-center text-center gap-2">
                  <input
                    type="file"
                    accept="image/png,image/bmp"
                    onChange={(e) => e.target.files?.[0] && handleCoverImageChange(e.target.files[0])}
                    className="hidden"
                    id="cover-upload"
                  />
                  <label
                    htmlFor="cover-upload"
                    className="px-4 py-2 rounded-xl bg-indigo-600/15 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/25 text-xs cursor-pointer transition-all flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Select Image File
                  </label>
                  <p className="text-[10px] text-text-secondary">
                    PNG or BMP recommended. High-resolution images provide larger capacity.
                  </p>
                </div>

                {imageDims && (
                  <div className="flex justify-between items-center text-[11px] text-text-secondary bg-cyber-dark p-3 rounded-xl border border-border-primary">
                    <span>
                      Dimensions: <strong className="text-text-primary">{imageDims.width}x{imageDims.height} px</strong>
                    </span>
                    <span>
                      Max Capacity: <strong className="text-emerald-400">{capacity} bytes</strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Payload Configuration */}
              <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  2. Choose Payload to Embed
                </h2>

                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="payloadType"
                      checked={payloadType === "share_token"}
                      onChange={() => setPayloadType("share_token")}
                      className="accent-indigo-500"
                    />
                    <span>Active Transfer Verification Token</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="payloadType"
                      checked={payloadType === "custom"}
                      onChange={() => setPayloadType("custom")}
                      className="accent-indigo-500"
                    />
                    <span>Custom Text / Encrypted Token</span>
                  </label>
                </div>

                {payloadType === "share_token" ? (
                  <div>
                    <label className="text-[11px] text-text-secondary block mb-1">
                      Select Transfer Link:
                    </label>
                    <select
                      value={selectedShareLink}
                      onChange={(e) => setSelectedShareLink(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs text-text-primary focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">-- Choose a transfer --</option>
                      {links.map((link) => (
                        <option key={link.id} value={link.id}>
                          Link #{link.id} ({link.transferMode}) - {link.recipientEmail || "Public"}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] text-text-secondary block mb-1">
                      Enter Payload:
                    </label>
                    <textarea
                      value={customPayloadText}
                      onChange={(e) => setCustomPayloadText(e.target.value)}
                      rows={3}
                      placeholder="Enter verification text or protected key package..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-dark border border-border-primary text-xs text-text-primary focus:outline-none focus:border-indigo-500 resize-none"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!coverImage || !imageDims}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Embed Payload into Image Carrier
                </button>
              </div>
            </form>
          </div>

          {/* Right: Preview & Result */}
          <div className="lg:col-span-5 space-y-6">
            <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Carrier Image Preview
              </h2>

              <div className="aspect-video w-full rounded-xl bg-cyber-dark border border-border-primary flex items-center justify-center overflow-hidden">
                {coverPreviewUrl ? (
                  <img
                    src={coverPreviewUrl}
                    alt="Cover Preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center text-text-secondary text-xs space-y-1">
                    <ImageIcon className="w-8 h-8 mx-auto text-text-secondary/40" />
                    <p>No image selected</p>
                  </div>
                )}
              </div>

              {embedStatus && (
                <div
                  className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
                    embedStatus.success
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                  }`}
                >
                  {embedStatus.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span>{embedStatus.message}</span>
                </div>
              )}

              {stegoDownloadUrl && (
                <a
                  href={stegoDownloadUrl}
                  download="stego_carrier_image.png"
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Stego-Image (.PNG)
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extract Mode */}
      {activeMode === "extract" && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="p-8 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-6">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary">
                Extract Steganography Carrier Payload
              </h2>
              <p className="text-xs text-text-secondary mt-1">
                Upload any image containing an embedded LSB payload to inspect its verification contents.
              </p>
            </div>

            <div className="p-8 rounded-xl border border-dashed border-border-primary bg-cyber-dark flex flex-col items-center justify-center text-center gap-3">
              <input
                type="file"
                accept="image/png,image/bmp"
                onChange={(e) => e.target.files?.[0] && handleExtractPayload(e.target.files[0])}
                className="hidden"
                id="extract-upload"
              />
              <label
                htmlFor="extract-upload"
                className="px-5 py-2.5 rounded-xl bg-indigo-600/15 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/25 text-xs font-bold cursor-pointer transition-all flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Select Stego-Image (.PNG)
              </label>
              {extractImage && (
                <span className="text-xs text-text-primary mt-1">
                  Selected: {extractImage.name} ({(extractImage.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>

            {isExtracting && (
              <div className="flex items-center justify-center gap-2 text-xs text-indigo-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Reading LSB bitstream and verifying CRC checksum...</span>
              </div>
            )}

            {extractStatus && (
              <div
                className={`p-4 rounded-xl text-xs space-y-3 ${
                  extractStatus.success
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {extractStatus.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>{extractStatus.message}</span>
                </div>

                {extractStatus.payload && (
                  <div className="p-3 bg-black/40 rounded-xl border border-border-primary space-y-1">
                    <span className="text-[10px] uppercase text-text-secondary">Extracted Content:</span>
                    <pre className="text-[11px] text-emerald-300 break-all whitespace-pre-wrap select-all font-mono">
                      {extractStatus.payload}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
