"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart3, Users, FileText, Lock, Link2, Activity,
  CheckCircle2, XCircle, Clock, ShieldAlert, HardDrive,
  RefreshCw, TrendingUp, Layers, PieChart, ShieldCheck,
  ArrowUpRight, AlertTriangle
} from "lucide-react";
import { motion } from "framer-motion";

interface AnalyticsData {
  summary: {
    totalUsers: number;
    activeUsers: number;
    totalDocuments: number;
    encryptedDocuments: number;
    activeTransfers: number;
    standardTransfers: number;
    blockchainTransfers: number;
    successfulDownloads: number;
    deniedAccessAttempts: number;
    expiredTransfers: number;
    revokedTransfers: number;
    pendingBlockchainProofs: number;
    failedBlockchainProofs: number;
    confirmedBlockchainProofs: number;
    totalEncryptedStorageBytes: number;
    securityAlerts: number;
  };
  charts: {
    sixMonthTrends: {
      monthKey: string;
      label: string;
      uploads: number;
      downloads: number;
    }[];
    transferModeDistribution: {
      standard: number;
      blockchain: number;
      total: number;
    };
    storageDistribution: {
      category: string;
      count: number;
      totalBytes: number;
      percentage: number;
    }[];
    accessRatio: {
      successful: number;
      denied: number;
      total: number;
    };
    dailySecurityEvents: {
      date: string;
      normal: number;
      security: number;
    }[];
    proofStatusDistribution: {
      confirmed: number;
      pending: number;
      failed: number;
    };
    operationComparison: {
      name: string;
      count: number;
      color: string;
    }[];
  };
}

export default function AdminAnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAnalytics = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/analytics");
      if (!res.ok) {
        throw new Error("Failed to load telemetry analytics.");
      }
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error fetching analytics data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 space-y-4 font-mono text-xs text-text-secondary">
        <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        <p>Aggregating database audit telemetry & analytics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono text-xs space-y-3">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="w-5 h-5" />
          <span>Telemetry Aggregation Error</span>
        </div>
        <p>{error || "No data available."}</p>
        <button
          onClick={fetchAnalytics}
          className="px-4 py-2 rounded-xl bg-rose-600/20 border border-rose-500/30 hover:bg-rose-600/30 text-rose-300 transition-all cursor-pointer"
        >
          Retry Query
        </button>
      </div>
    );
  }

  const { summary, charts } = data;

  // Max value calculation for bar chart normalization
  const maxMonthVal = Math.max(
    ...charts.sixMonthTrends.map((t) => Math.max(t.uploads, t.downloads)),
    1
  );

  const maxDailyVal = Math.max(
    ...charts.dailySecurityEvents.map((e) => Math.max(e.normal, e.security)),
    1
  );

  const maxOpVal = Math.max(...charts.operationComparison.map((o) => o.count), 1);

  return (
    <div className="space-y-8 font-mono select-none">
      {/* Title & Refresh */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            <BarChart3 className="w-4 h-4" />
            <span>Administrative Command Center</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Security & Document Analytics
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Real database metrics, transfer distributions, audit logs, and cryptographic health.
          </p>
        </div>
        <button
          onClick={fetchAnalytics}
          className="px-4 py-2.5 rounded-xl border border-border-primary bg-cyber-card hover:bg-cyber-dark text-text-primary text-xs flex items-center gap-2 cursor-pointer transition-all self-start md:self-auto shadow-md"
        >
          <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
          Refresh Analytics
        </button>
      </div>

      {/* 1. Summary Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Registered Users",
            val: summary.totalUsers,
            sub: `${summary.activeUsers} active (30d)`,
            icon: Users,
            color: "text-indigo-400",
            bg: "bg-indigo-500/10",
          },
          {
            label: "Encrypted Documents",
            val: summary.totalDocuments,
            sub: "100% AES-256-GCM sealed",
            icon: Lock,
            color: "text-cyan-400",
            bg: "bg-cyan-500/10",
          },
          {
            label: "Active Transfers",
            val: summary.activeTransfers,
            sub: `${summary.standardTransfers} Std / ${summary.blockchainTransfers} Chain`,
            icon: Link2,
            color: "text-purple-400",
            bg: "bg-purple-500/10",
          },
          {
            label: "Successful Downloads",
            val: summary.successfulDownloads,
            sub: `${summary.deniedAccessAttempts} denied attempts`,
            icon: CheckCircle2,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Expired & Revoked",
            val: summary.expiredTransfers + summary.revokedTransfers,
            sub: `${summary.expiredTransfers} expired · ${summary.revokedTransfers} revoked`,
            icon: Clock,
            color: "text-amber-400",
            bg: "bg-amber-500/10",
          },
          {
            label: "Blockchain Proofs",
            val: summary.confirmedBlockchainProofs,
            sub: `${summary.pendingBlockchainProofs} pending · ${summary.failedBlockchainProofs} failed`,
            icon: ShieldCheck,
            color: "text-teal-400",
            bg: "bg-teal-500/10",
          },
          {
            label: "Encrypted Storage",
            val: formatBytes(summary.totalEncryptedStorageBytes),
            sub: "Stored off-chain securely",
            icon: HardDrive,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Security Threats",
            val: summary.securityAlerts,
            sub: "Rate & geo anomalies",
            icon: ShieldAlert,
            color: "text-rose-400",
            bg: "bg-rose-500/10",
          },
        ].map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="p-4 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-2 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary uppercase tracking-wider">
                  {card.label}
                </span>
                <div className={`p-1.5 rounded-lg ${card.bg} ${card.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-xl font-bold text-text-primary tracking-tight">
                {card.val}
              </div>
              <div className="text-[10px] text-text-secondary truncate">
                {card.sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. Visual Analytics Section: Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Six-Month Upload and Download Trends (7 cols) */}
        <div className="lg:col-span-7 p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-400" />
                6-Month Upload & Download Volume
              </h2>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Monthly encrypted documents stored vs authorized retrievals
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Uploads
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Downloads
              </span>
            </div>
          </div>

          <div className="h-48 flex items-end justify-between gap-3 pt-6 border-b border-border-primary pb-3">
            {charts.sixMonthTrends.map((t, idx) => {
              const uploadHeight = Math.max(Math.round((t.uploads / maxMonthVal) * 100), 6);
              const downloadHeight = Math.max(Math.round((t.downloads / maxMonthVal) * 100), 6);

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                  <div className="w-full flex items-end justify-center gap-1.5 h-36">
                    {/* Upload bar */}
                    <div
                      style={{ height: `${uploadHeight}%` }}
                      className="w-1/2 max-w-[18px] bg-indigo-500/80 rounded-t-sm group-hover:bg-indigo-400 transition-all relative"
                    >
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-black px-1.5 py-0.5 rounded text-[9px] text-indigo-300 pointer-events-none transition-opacity">
                        {t.uploads}
                      </div>
                    </div>
                    {/* Download bar */}
                    <div
                      style={{ height: `${downloadHeight}%` }}
                      className="w-1/2 max-w-[18px] bg-emerald-500/80 rounded-t-sm group-hover:bg-emerald-400 transition-all relative"
                    >
                      <div className="opacity-0 group-hover:opacity-100 absolute -top-6 left-1/2 -translate-x-1/2 bg-black px-1.5 py-0.5 rounded text-[9px] text-emerald-300 pointer-events-none transition-opacity">
                        {t.downloads}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-text-secondary">{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Transfer Mode Distribution & Access Ratio (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Transfer Mode Gauge */}
          <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                Transfer Mode Distribution
              </h2>
              <span className="text-[10px] text-text-secondary">
                {charts.transferModeDistribution.total} total shares
              </span>
            </div>

            <div className="space-y-2">
              <div className="w-full h-3 rounded-full bg-cyber-dark overflow-hidden flex border border-border-primary">
                <div
                  style={{
                    width: `${
                      charts.transferModeDistribution.total > 0
                        ? (charts.transferModeDistribution.standard / charts.transferModeDistribution.total) * 100
                        : 50
                    }%`,
                  }}
                  className="bg-indigo-500 h-full"
                />
                <div
                  style={{
                    width: `${
                      charts.transferModeDistribution.total > 0
                        ? (charts.transferModeDistribution.blockchain / charts.transferModeDistribution.total) * 100
                        : 50
                    }%`,
                  }}
                  className="bg-purple-500 h-full"
                />
              </div>

              <div className="flex justify-between text-xs pt-1">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-indigo-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    Standard Transfer
                  </div>
                  <div className="text-text-secondary text-[11px]">
                    {charts.transferModeDistribution.standard} shares (
                    {charts.transferModeDistribution.total > 0
                      ? Math.round(
                          (charts.transferModeDistribution.standard / charts.transferModeDistribution.total) * 100
                        )
                      : 0}
                    %)
                  </div>
                </div>

                <div className="space-y-0.5 text-right">
                  <div className="flex items-center gap-1.5 justify-end text-purple-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    Blockchain Transfer
                  </div>
                  <div className="text-text-secondary text-[11px]">
                    {charts.transferModeDistribution.blockchain} shares (
                    {charts.transferModeDistribution.total > 0
                      ? Math.round(
                          (charts.transferModeDistribution.blockchain / charts.transferModeDistribution.total) * 100
                        )
                      : 0}
                    %)
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Access Policy Success vs Denied Attempts */}
          <div className="p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary flex items-center gap-2">
              <PieChart className="w-4 h-4 text-emerald-400" />
              Access Attempt Ratio
            </h2>

            <div className="space-y-2">
              <div className="w-full h-3 rounded-full bg-cyber-dark overflow-hidden flex border border-border-primary">
                <div
                  style={{
                    width: `${
                      charts.accessRatio.total > 0
                        ? (charts.accessRatio.successful / charts.accessRatio.total) * 100
                        : 100
                    }%`,
                  }}
                  className="bg-emerald-500 h-full"
                />
                <div
                  style={{
                    width: `${
                      charts.accessRatio.total > 0
                        ? (charts.accessRatio.denied / charts.accessRatio.total) * 100
                        : 0
                    }%`,
                  }}
                  className="bg-rose-500 h-full"
                />
              </div>

              <div className="flex justify-between text-xs pt-1">
                <div>
                  <span className="text-emerald-400 font-bold">
                    {charts.accessRatio.successful} Allowed
                  </span>
                  <p className="text-[10px] text-text-secondary">Policy Verified</p>
                </div>
                <div className="text-right">
                  <span className="text-rose-400 font-bold">
                    {charts.accessRatio.denied} Denied / Frozen
                  </span>
                  <p className="text-[10px] text-text-secondary">Policy Violations</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Visual Analytics Section: Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Document Storage Category Breakdown (6 cols) */}
        <div className="lg:col-span-6 p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            Document Storage Distribution
          </h2>
          <p className="text-[11px] text-text-secondary">
            Payload classification and off-chain disk volume by file format
          </p>

          <div className="space-y-3 pt-2">
            {charts.storageDistribution.map((cat, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-text-primary font-medium">{cat.category}</span>
                  <span className="text-text-secondary">
                    {cat.count} files · {formatBytes(cat.totalBytes)} ({cat.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-cyber-dark overflow-hidden border border-border-primary">
                  <div
                    style={{ width: `${Math.max(cat.percentage, cat.count > 0 ? 5 : 0)}%` }}
                    className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Operation-Wise Comparison (6 cols) */}
        <div className="lg:col-span-6 p-6 rounded-2xl bg-cyber-card border border-border-primary shadow-sm space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            Operation-Wise Ledger Comparison
          </h2>
          <p className="text-[11px] text-text-secondary">
            Cumulative event distribution across all cryptographic lifecycle operations
          </p>

          <div className="space-y-3 pt-2">
            {charts.operationComparison.map((op, idx) => {
              const widthPct = Math.max(Math.round((op.count / maxOpVal) * 100), op.count > 0 ? 4 : 0);
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-primary font-medium">{op.name}</span>
                    <span className="text-text-secondary font-bold">{op.count} events</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-cyber-dark overflow-hidden border border-border-primary">
                    <div
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: op.color,
                      }}
                      className="h-full rounded-full transition-all"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Blockchain Proof Status Breakdown Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/20 via-cyber-card to-indigo-950/20 border border-purple-500/20 shadow-md space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-purple-400">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="text-sm font-bold uppercase tracking-wider">
              Smart Contract Proof Status Monitor
            </h3>
          </div>
          <span className="text-xs text-text-secondary">
            Network: Sepolia Testnet / Local Registry
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="p-3 rounded-xl bg-cyber-dark border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-text-secondary uppercase">Confirmed On-Chain</span>
              <div className="text-lg font-bold text-emerald-400">
                {charts.proofStatusDistribution.confirmed} Proofs
              </div>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>

          <div className="p-3 rounded-xl bg-cyber-dark border border-amber-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-text-secondary uppercase">Pending RPC Block</span>
              <div className="text-lg font-bold text-amber-400">
                {charts.proofStatusDistribution.pending} Proofs
              </div>
            </div>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>

          <div className="p-3 rounded-xl bg-cyber-dark border border-rose-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-text-secondary uppercase">Failed Transactions</span>
              <div className="text-lg font-bold text-rose-400">
                {charts.proofStatusDistribution.failed} Proofs
              </div>
            </div>
            <XCircle className="w-5 h-5 text-rose-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
