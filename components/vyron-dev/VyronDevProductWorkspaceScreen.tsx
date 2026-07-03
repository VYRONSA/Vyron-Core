"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, ExternalLink, PackageCheck, Server, ShieldCheck } from "lucide-react";
import {
  VYRON_PRODUCT_DEPLOYMENTS,
  VYRON_PRODUCT_NAMES,
  getClientProductStatus,
  getPackageById,
  formatVyronPackageMonthlyValue,
  getClientProductWorkspace,
  isCoreProductAvailable,
  type VyronDevActiveClientContext,
  type VyronDevPlatformState,
  type VyronProductCode,
  type VyronSupportSessionContext,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  productCode: VyronProductCode;
  activeClient: VyronDevActiveClientContext | null;
  supportSession: VyronSupportSessionContext | null;
  platformState: VyronDevPlatformState;
  onBack: () => void;
  onOpenCore?: () => void;
  onWorkspaceOpened?: (clientId: string, productCode: VyronProductCode) => void;
  deployments?: typeof VYRON_PRODUCT_DEPLOYMENTS;
};

function statusClass(status: string) {
  if (status === "enabled" || status === "active" || status === "healthy") return "bg-emerald-100 text-emerald-800";
  if (status === "trial" || status === "provisioning") return "bg-cyan-100 text-cyan-800";
  if (status === "suspended" || status === "maintenance") return "bg-amber-100 text-amber-900";
  return "bg-slate-200 text-slate-700";
}

export default function VyronDevProductWorkspaceScreen({
  productCode,
  activeClient,
  supportSession,
  platformState,
  onBack,
  onOpenCore,
  onWorkspaceOpened,
  deployments = VYRON_PRODUCT_DEPLOYMENTS,
}: Props) {
  const openedRef = useRef<string | null>(null);

  const contextClient = useMemo(() => {
    if (supportSession && supportSession.productCode === productCode) {
      return {
        clientId: supportSession.clientId,
        companyName: supportSession.companyName,
      };
    }
    if (activeClient) {
      return {
        clientId: activeClient.clientId,
        companyName: activeClient.companyName,
      };
    }
    return null;
  }, [activeClient, supportSession, productCode]);

  const workspace = useMemo(() => {
    if (!contextClient) return null;
    return getClientProductWorkspace(platformState, contextClient.clientId, productCode);
  }, [contextClient, platformState, productCode]);

  const status = contextClient
    ? getClientProductStatus(platformState, contextClient.clientId, productCode)
    : "disabled";

  const pkg = getPackageById(workspace?.packageId);
  const deployment = deployments.find((item) => item.productCode === productCode);
  const isCore = isCoreProductAvailable(productCode);
  const supportModeActive = Boolean(supportSession && supportSession.productCode === productCode);

  useEffect(() => {
    if (!contextClient || !onWorkspaceOpened) return;
    const key = `${contextClient.clientId}:${productCode}`;
    if (openedRef.current === key) return;
    openedRef.current = key;
    onWorkspaceOpened(contextClient.clientId, productCode);
  }, [contextClient, productCode, onWorkspaceOpened]);

  function openDeploymentUrl() {
    if (!deployment?.url) return;
    window.open(deployment.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Product Workspace</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">
              {productCode} — {contextClient?.companyName ?? "No client selected"}
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Client product workspace record for vyron_product_workspaces. This screen shows support context,
              workspace status, package limits, deployment status and safe open actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            {deployment?.url && (
              <button
                type="button"
                onClick={openDeploymentUrl}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg"
              >
                <ExternalLink className="h-4 w-4" />
                Open Product URL
              </button>
            )}
          </div>
        </div>

        {supportModeActive && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Support Mode: Viewing {supportSession?.companyName} / {supportSession?.productCode}. This is a safe support
            session foundation, not unsafe auth impersonation.
          </div>
        )}

        {!contextClient ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">
            Start a support session or select a client via Login As Client before opening a product workspace.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500">Workspace</div>
                  <div className="text-lg font-black text-slate-950">{VYRON_PRODUCT_NAMES[productCode]}</div>
                </div>
              </div>
              <dl className="mt-5 space-y-3 text-sm font-semibold text-slate-700">
                <div className="flex justify-between gap-4">
                  <dt>Product</dt>
                  <dd className="font-black text-slate-950">{productCode}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Workspace ID</dt>
                  <dd className="font-mono text-xs">{workspace?.workspaceId ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Client ID</dt>
                  <dd className="font-mono text-xs">{contextClient.clientId}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Status</dt>
                  <dd>
                    <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(status)}`}>
                      {status}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Workspace Status</dt>
                  <dd>
                    <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(workspace?.workspaceStatus || "disabled")}`}>
                      {workspace?.workspaceStatus ?? "—"}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Created</dt>
                  <dd>
                    {workspace?.createdAt
                      ? new Date(workspace.createdAt).toLocaleString("en-ZA")
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Last Opened</dt>
                  <dd>
                    {workspace?.lastOpenedAt
                      ? new Date(workspace.lastOpenedAt).toLocaleString("en-ZA")
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500">Package Limits</div>
                  <div className="text-lg font-black text-slate-950">{pkg?.packageName ?? "No package"}</div>
                </div>
              </div>
              {pkg ? (
                <dl className="mt-5 space-y-3 text-sm font-semibold text-slate-700">
                  <div className="flex justify-between gap-4">
                    <dt>User limit</dt>
                    <dd>{pkg.userLimit ?? "Unlimited"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Company limit</dt>
                    <dd>{pkg.companyLimit ?? "Unlimited"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Storage</dt>
                    <dd>{pkg.storageLimitGb ?? "Unlimited"} GB</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>Monthly value</dt>
                    <dd className="font-black text-emerald-800">
                      {formatVyronPackageMonthlyValue(pkg.monthlyValue, pkg.packageName)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-5 text-sm text-slate-500">No package assigned.</p>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500">Deployment</div>
                  <div className="text-lg font-black text-slate-950">{deployment?.environment ?? "Not set"}</div>
                </div>
              </div>
              <dl className="mt-5 space-y-3 text-sm font-semibold text-slate-700">
                <div className="flex justify-between gap-4">
                  <dt>Version</dt>
                  <dd className="font-mono text-xs">{deployment?.version ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Status</dt>
                  <dd>
                    <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusClass(deployment?.deploymentStatus || "not_deployed")}`}>
                      {deployment?.deploymentStatus?.replaceAll("_", " ") ?? "—"}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Database</dt>
                  <dd>{deployment?.dbStatus ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Last deploy</dt>
                  <dd>
                    {deployment?.lastDeployment
                      ? new Date(deployment.lastDeployment).toLocaleString("en-ZA")
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>URL</dt>
                  <dd className="max-w-[190px] truncate text-right text-xs">{deployment?.url?.replace("https://", "") ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {isCore && contextClient && onOpenCore && status !== "disabled" && (
            <button
              type="button"
              onClick={onOpenCore}
              className="rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-700/20"
            >
              Open CORE Command Centre
            </button>
          )}
        </div>
      </VyronDevPanel>
    </div>
  );
}
