"use client";

import React, { useMemo } from "react";
import { Boxes, Cloud, CloudOff, PackageCheck, WalletCards } from "lucide-react";
import {
  VYRON_DEV_DEFAULT_PACKAGES,
  VYRON_PRODUCT_CODES,
  VYRON_PRODUCT_NAMES,
  formatVyronPackageMonthlyValue,
  getPackageById,
  getPackagesForProduct,
  type VyronDevPersistenceStatus,
  type VyronDevPlatformState,
  type VyronProductCode,
} from "@/lib/vyron-dev-platform";
import VyronDevPanel from "./VyronDevPanel";

type Props = {
  platformState: VyronDevPlatformState;
  packagesSynced?: boolean;
  persistenceStatus?: VyronDevPersistenceStatus;
};

function packageStatusClass(status: string) {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "draft") return "bg-cyan-100 text-cyan-800";
  return "bg-slate-200 text-slate-700";
}

export default function VyronDevPackageEnginePanel({
  platformState,
  packagesSynced = false,
  persistenceStatus = "local",
}: Props) {
  const assignmentCount = useMemo(() => {
    let count = 0;
    for (const assignments of Object.values(platformState.clientPackageAssignments)) {
      count += Object.keys(assignments || {}).length;
    }
    return count;
  }, [platformState.clientPackageAssignments]);

  const productPackageValue = useMemo(() => {
    return VYRON_PRODUCT_CODES.reduce(
      (acc, code) => {
        acc[code] = getPackagesForProduct(code).reduce(
          (sum, pkg) => sum + (pkg.monthlyValue > 0 ? pkg.monthlyValue : 0),
          0
        );
        return acc;
      },
      {} as Record<VyronProductCode, number>
    );
  }, []);

  const assignedMonthlyValue = useMemo(() => {
    let total = 0;
    for (const assignments of Object.values(platformState.clientPackageAssignments)) {
      for (const packageId of Object.values(assignments || {})) {
        total += getPackageById(packageId)?.monthlyValue || 0;
      }
    }
    return total;
  }, [platformState.clientPackageAssignments]);

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Package Engine</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">vyron_product_packages</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Starter, Professional, Growth and Enterprise packages across the full VYRON ecosystem. Client
              package assignments are tracked locally and synced to Supabase when vyron_product_packages is available.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-cyan-100 bg-cyan-50 px-5 py-4 text-center">
              <div className="text-2xl font-black text-cyan-900">{VYRON_DEV_DEFAULT_PACKAGES.length}</div>
              <div className="text-xs font-black uppercase tracking-wider text-cyan-700">Packages</div>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-center">
              <div className="text-2xl font-black text-emerald-900">{assignmentCount}</div>
              <div className="text-xs font-black uppercase tracking-wider text-emerald-700">Assignments</div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-center">
              <div className="text-2xl font-black text-slate-950">R {assignedMonthlyValue.toLocaleString("en-ZA")}</div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">Assigned Value</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <div
            className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-black ${
              packagesSynced ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
            }`}
          >
            {packagesSynced ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            Packages {packagesSynced ? "synced to Supabase" : "from local catalogue"}
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-cyan-50 px-4 py-2 text-xs font-black text-cyan-800">
            Platform persistence: {persistenceStatus}
          </div>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
            <WalletCards className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Package Value Matrix</div>
            <h3 className="mt-1 text-lg font-bold">Product package catalogue</h3>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {VYRON_PRODUCT_CODES.map((code) => (
            <div key={code} className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500">{code}</div>
                  <div className="mt-1 text-sm font-black text-slate-950">{VYRON_PRODUCT_NAMES[code]}</div>
                </div>
                <Boxes className="h-5 w-5 text-cyan-700" />
              </div>
              <div className="mt-5 text-2xl font-black text-slate-950">
                R {productPackageValue[code].toLocaleString("en-ZA")}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-500">Total catalogue value across packages</div>
            </div>
          ))}
        </div>
      </VyronDevPanel>

      {VYRON_PRODUCT_CODES.map((code) => {
        const packages = getPackagesForProduct(code);
        return (
          <VyronDevPanel key={code}>
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">{code}</div>
                <h3 className="mt-2 text-lg font-bold">{VYRON_PRODUCT_NAMES[code]} packages</h3>
              </div>
              <div className="inline-flex w-fit rounded-full bg-cyan-100 px-4 py-2 text-xs font-black text-cyan-800">
                {packages.length} active package templates
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                    <th className="px-4 py-3">Package Name</th>
                    <th className="px-4 py-3">Employee Limit</th>
                    <th className="px-4 py-3">Company Limit</th>
                    <th className="px-4 py-3">Storage</th>
                    <th className="px-4 py-3">Monthly Value</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Billing Role</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((pkg) => (
                    <tr key={pkg.id} className="rounded-2xl bg-white/90 shadow-sm">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 font-bold text-slate-950">
                          <PackageCheck className="h-4 w-4 text-cyan-700" />
                          {pkg.packageName}
                        </div>
                      </td>
                      <td className="px-4 py-4">{pkg.userLimit ?? "Unlimited"}</td>
                      <td className="px-4 py-4">{pkg.companyLimit ?? "Unlimited"}</td>
                      <td className="px-4 py-4">{pkg.storageLimitGb ?? "Unlimited"} GB</td>
                      <td className="px-4 py-4 font-black text-emerald-800">
                        {formatVyronPackageMonthlyValue(pkg.monthlyValue, pkg.packageName)}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${packageStatusClass(pkg.status)}`}>
                          {pkg.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {pkg.monthlyValue === 0 && pkg.packageName.toLowerCase().includes("enterprise")
                          ? "Contact Sales"
                          : pkg.monthlyValue === 0
                            ? "Demo / Free"
                            : "Standard billing"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </VyronDevPanel>
        );
      })}
    </div>
  );
}
