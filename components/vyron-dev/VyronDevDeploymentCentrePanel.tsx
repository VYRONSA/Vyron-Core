"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, ExternalLink, Server, ShieldCheck } from "lucide-react";
import {
  VYRON_PRODUCT_DEPLOYMENTS,
  VYRON_PRODUCT_NAMES,
  deploymentStatusClass,
  deploymentStatusLabel,
  fetchVyronProductDeploymentsFromSupabase,
  type VyronProductDeployment,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

function healthScore(deployments: VyronProductDeployment[]) {
  const total = deployments.length || 1;
  const healthy = deployments.filter((dep) => dep.deploymentStatus === "healthy").length;
  return Math.round((healthy / total) * 100);
}

export default function VyronDevDeploymentCentrePanel() {
  const [deployments, setDeployments] = useState<VyronProductDeployment[]>(VYRON_PRODUCT_DEPLOYMENTS);
  const [source, setSource] = useState<"constants" | "supabase">("constants");

  useEffect(() => {
    let cancelled = false;
    async function loadDeployments() {
      const result = await fetchVyronProductDeploymentsFromSupabase();
      if (cancelled) return;
      if (result.deployments?.length) {
        setDeployments(result.deployments);
        setSource("supabase");
      } else {
        setDeployments(VYRON_PRODUCT_DEPLOYMENTS);
        setSource("constants");
      }
    }
    void loadDeployments();
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => {
    const healthy = deployments.filter((dep) => dep.deploymentStatus === "healthy").length;
    const review = deployments.filter((dep) => dep.deploymentStatus === "needs_review").length;
    const maintenance = deployments.filter((dep) => dep.deploymentStatus === "maintenance").length;
    const notDeployed = deployments.filter((dep) => dep.deploymentStatus === "not_deployed").length;
    return { healthy, review, maintenance, notDeployed, score: healthScore(deployments) };
  }, [deployments]);

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Deployment Centre</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Product deployments</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Per-product version, deployment status, database health, environment, and URL control foundation for the
              full VYRON ecosystem. Loads from vyron_product_deployments when available.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-3xl border border-cyan-100 bg-cyan-50 px-6 py-5 text-center">
              <div className="text-4xl font-black text-cyan-900">{metrics.score}%</div>
              <div className="mt-1 text-xs font-black uppercase tracking-wider text-cyan-700">Deployment Health</div>
            </div>
            <div
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-xs font-black ${
                source === "supabase" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              {source === "supabase" ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
              Source: {source === "supabase" ? "Supabase" : "local constants"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            <div className="mt-3 text-3xl font-black text-emerald-900">{metrics.healthy}</div>
            <div className="text-xs font-black uppercase tracking-wider text-emerald-700">Healthy</div>
          </div>
          <div className="rounded-3xl border border-amber-100 bg-amber-50 p-5">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <div className="mt-3 text-3xl font-black text-amber-900">{metrics.review}</div>
            <div className="text-xs font-black uppercase tracking-wider text-amber-700">Needs Review</div>
          </div>
          <div className="rounded-3xl border border-violet-100 bg-violet-50 p-5">
            <ShieldCheck className="h-5 w-5 text-violet-700" />
            <div className="mt-3 text-3xl font-black text-violet-900">{metrics.maintenance}</div>
            <div className="text-xs font-black uppercase tracking-wider text-violet-700">Maintenance</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <Server className="h-5 w-5 text-slate-700" />
            <div className="mt-3 text-3xl font-black text-slate-900">{metrics.notDeployed}</div>
            <div className="text-xs font-black uppercase tracking-wider text-slate-500">Not Deployed</div>
          </div>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Deployment Status</th>
                <th className="px-4 py-3">DB Status</th>
                <th className="px-4 py-3">Last Deployment</th>
                <th className="px-4 py-3">Environment</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((dep) => (
                <tr key={dep.productCode} className="rounded-2xl bg-white/90 shadow-sm">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 font-black text-slate-950">
                      <Server className="h-4 w-4 text-slate-400" />
                      <div>
                        <div>{dep.productCode}</div>
                        <div className="text-xs font-semibold text-slate-500">
                          {VYRON_PRODUCT_NAMES[dep.productCode]}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">{dep.version}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${deploymentStatusClass(dep.deploymentStatus)}`}
                    >
                      {deploymentStatusLabel(dep.deploymentStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-700">{dep.dbStatus}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {dep.lastDeployment
                      ? new Date(dep.lastDeployment).toLocaleString("en-ZA")
                      : "—"}
                  </td>
                  <td className="px-4 py-4 capitalize">{dep.environment}</td>
                  <td className="px-4 py-4">
                    <a
                      href={dep.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-black text-cyan-700 hover:text-cyan-900"
                    >
                      {dep.url.replace("https://", "")}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                  <td className="px-4 py-4">
                    <a
                      href={dep.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-2 text-xs font-black text-cyan-800 hover:bg-cyan-100"
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VyronDevPanel>
    </div>
  );
}
