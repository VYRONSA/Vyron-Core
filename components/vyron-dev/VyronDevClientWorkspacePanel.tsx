"use client";

import React, { useMemo } from "react";
import {
  VYRON_PRODUCT_CODES,
  VYRON_PRODUCT_NAMES,
  assignClientPackage,
  formatVyronPackageMonthlyValue,
  getClientProductStatus,
  getClientProductWorkspace,
  getPackageById,
  getPackagesForProduct,
  isCoreProductAvailable,
  productOpenLabel,
  setClientProductStatus,
  type VyronDevDirectoryClient,
  type VyronDevPlatformState,
  type VyronProductCode,
  type VyronProductStatus,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  client: VyronDevDirectoryClient;
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onOpenProduct: (productCode: VyronProductCode) => void;
};

const STATUS_LABELS: Record<VyronProductStatus, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  trial: "Trial",
  suspended: "Suspended",
};

function statusBadgeClass(status: VyronProductStatus): string {
  if (status === "enabled") return "bg-emerald-100 text-emerald-800";
  if (status === "trial") return "bg-cyan-100 text-cyan-800";
  if (status === "suspended") return "bg-amber-100 text-amber-900";
  return "bg-slate-200 text-slate-700";
}

export default function VyronDevClientWorkspacePanel({
  client,
  platformState,
  onPlatformStateChange,
  onOpenProduct,
}: Props) {
  const rows = useMemo(
    () =>
      VYRON_PRODUCT_CODES.map((code) => {
        const status = getClientProductStatus(platformState, client.id, code);
        const workspace = getClientProductWorkspace(platformState, client.id, code);
        const packages = getPackagesForProduct(code);
        const assignedId = platformState.clientPackageAssignments[client.id]?.[code] ?? "";
        const pkg = getPackageById(assignedId || workspace?.packageId);
        return { code, status, packages, assignedId, pkg, workspace };
      }),
    [client.id, platformState]
  );

  function applyStatus(code: VyronProductCode, status: VyronProductStatus) {
    const packages = getPackagesForProduct(code);
    const defaultPkg = packages[0]?.id ?? null;
    onPlatformStateChange(
      setClientProductStatus(platformState, client.id, code, status, defaultPkg)
    );
  }

  function handlePackageChange(code: VyronProductCode, packageId: string) {
    onPlatformStateChange(assignClientPackage(platformState, client.id, code, packageId));
  }

  return (
    <VyronDevPanel>
      <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Product Enablement</div>
      <h3 className="mt-2 text-xl font-bold tracking-tight">{client.companyName}</h3>
      <p className="mt-2 text-sm text-slate-500">
        Enable products, assign packages, and open workspace foundations per product line.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
              <th className="px-4 py-3">Product Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Monthly Value</th>
              <th className="px-4 py-3">Workspace Status</th>
              <th className="px-4 py-3">Created Date</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ code, status, packages, assignedId, pkg, workspace }) => (
              <tr key={code} className="rounded-2xl bg-white/90 shadow-sm">
                <td className="px-4 py-4 font-black text-slate-950">{code}</td>
                <td className="px-4 py-4 text-slate-700">{VYRON_PRODUCT_NAMES[code]}</td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${statusBadgeClass(status)}`}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {packages.length > 0 ? (
                    <select
                      value={assignedId}
                      disabled={status === "disabled"}
                      onChange={(e) => handlePackageChange(code, e.target.value)}
                      className="max-w-[220px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-black text-slate-800 disabled:opacity-50"
                    >
                      <option value="">Select package…</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.packageName} — {formatVyronPackageMonthlyValue(p.monthlyValue, p.packageName)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-4 font-semibold text-emerald-800">
                  {pkg ? formatVyronPackageMonthlyValue(pkg.monthlyValue, pkg.packageName) : "—"}
                </td>
                <td className="px-4 py-4 capitalize text-slate-700">
                  {workspace?.workspaceStatus ?? "—"}
                </td>
                <td className="px-4 py-4 text-slate-600">
                  {workspace?.createdAt
                    ? new Date(workspace.createdAt).toLocaleDateString("en-ZA")
                    : "—"}
                </td>
                <td className="px-4 py-4 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {status === "disabled" && (
                      <button
                        type="button"
                        onClick={() => applyStatus(code, "enabled")}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-900"
                      >
                        Enable
                      </button>
                    )}
                    {status !== "disabled" && (
                      <button
                        type="button"
                        onClick={() => applyStatus(code, "disabled")}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-800"
                      >
                        Disable
                      </button>
                    )}
                    {status !== "trial" && status !== "disabled" && (
                      <button
                        type="button"
                        onClick={() => applyStatus(code, "trial")}
                        className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-900"
                      >
                        Start Trial
                      </button>
                    )}
                    {status !== "suspended" && status !== "disabled" && (
                      <button
                        type="button"
                        onClick={() => applyStatus(code, "suspended")}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900"
                      >
                        Suspend
                      </button>
                    )}
                    {status !== "disabled" && (
                      <button
                        type="button"
                        onClick={() => onOpenProduct(code)}
                        className={`rounded-xl border px-3 py-2 text-xs font-black ${
                          isCoreProductAvailable(code)
                            ? "border-cyan-200 bg-cyan-50 text-cyan-900"
                            : "border-slate-200 bg-slate-100 text-slate-600"
                        }`}
                      >
                        {productOpenLabel(code)}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VyronDevPanel>
  );
}
