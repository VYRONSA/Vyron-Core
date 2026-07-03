"use client";

import React, { useMemo, useState } from "react";
import { Building2, Cloud, CloudOff, Plus, Rocket, ShieldCheck } from "lucide-react";
import {
  VYRON_PRODUCT_CODES,
  VYRON_PRODUCT_NAMES,
  formatVyronPackageMonthlyValue,
  getPackagesForProduct,
  mapDirectoryEntryToDevClient,
  provisionVyronClient,
  setClientProductStatus,
  type VyronDevClientStatus,
  type VyronDevDirectorySourceEntry,
  type VyronDevPersistenceStatus,
  type VyronDevPlatformState,
  type VyronProductCode,
} from "@/lib/vyron-dev-platform";
import { validateClientLoginPassword } from "@/lib/create-client-login-user";
import VyronDevPanel from "./VyronDevPanel";

export type VyronDevProvisionedClientPayload = {
  clientId: string;
  companyName: string;
  tradingName: string;
  industry: string;
  primaryContact: string;
  email: string;
  phone: string;
  status: VyronDevClientStatus;
  createdAt: string;
  clientRef: string;
};

type Props = {
  entries: VyronDevDirectorySourceEntry[];
  platformState: VyronDevPlatformState;
  onPlatformStateChange: (next: VyronDevPlatformState) => void;
  onProvisionClient?: (payload: VyronDevProvisionedClientPayload) => void | Promise<void>;
  onResolveCompanyId?: (input: {
    companyName: string;
    email: string;
    password: string;
    contactPerson: string;
    phone: string;
    status: VyronDevClientStatus;
  }) => Promise<{ companyId: string; loginWarning?: string | null } | null>;
  persistenceStatus?: VyronDevPersistenceStatus;
  onSyncProvisionedClient?: (
    clientId: string,
    state: VyronDevPlatformState
  ) => Promise<"local" | "supabase">;
};

const STATUS_OPTIONS: VyronDevClientStatus[] = ["active", "trial", "suspended"];
const INDUSTRY_OPTIONS = [
  "General",
  "Retail",
  "Food Manufacturing",
  "Construction",
  "Plant Hire / Yellow Metal",
  "Agriculture",
  "Property / Maintenance",
  "Payroll / HR Services",
  "Finance / Accounting",
  "Field Services",
];

function statusBadgeClass(status: VyronDevClientStatus) {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "trial") return "bg-cyan-100 text-cyan-800";
  if (status === "suspended") return "bg-amber-100 text-amber-900";
  return "bg-slate-200 text-slate-700";
}

function productAccent(productCode: VyronProductCode) {
  if (productCode === "CORE") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (productCode === "COST") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (productCode === "PAY") return "border-rose-200 bg-rose-50 text-rose-800";
  if (productCode === "FARM") return "border-lime-200 bg-lime-50 text-lime-800";
  if (productCode === "MAINT") return "border-amber-200 bg-amber-50 text-amber-900";
  if (productCode === "REACH") return "border-violet-200 bg-violet-50 text-violet-900";
  if (productCode === "FINANCE") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

export default function VyronDevProvisioningPanel({
  entries,
  platformState,
  onPlatformStateChange,
  onProvisionClient,
  onResolveCompanyId,
  persistenceStatus = "local",
  onSyncProvisionedClient,
}: Props) {
  const [companyName, setCompanyName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [industry, setIndustry] = useState("General");
  const [primaryContact, setPrimaryContact] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<VyronDevClientStatus>("active");
  const [selectedProducts, setSelectedProducts] = useState<Record<VyronProductCode, boolean>>({
    CORE: true,
    COST: false,
    PAY: false,
    FARM: false,
    MAINT: false,
    REACH: false,
    FINANCE: false,
    BUILD: false,
  });
  const [productPackages, setProductPackages] = useState<Partial<Record<VyronProductCode, string>>>(() => {
    const defaults: Partial<Record<VyronProductCode, string>> = {};
    for (const code of VYRON_PRODUCT_CODES) {
      defaults[code] = getPackagesForProduct(code)[0]?.id;
    }
    return defaults;
  });
  const [provisioning, setProvisioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recentClients = useMemo(
    () =>
      entries
        .map((e) => mapDirectoryEntryToDevClient(e, platformState))
        .slice(0, 10),
    [entries, platformState]
  );

  const selectedProductCodes = useMemo(
    () => VYRON_PRODUCT_CODES.filter((code) => selectedProducts[code]),
    [selectedProducts]
  );

  const selectedMonthlyValue = useMemo(() => {
    return selectedProductCodes.reduce((sum, code) => {
      const pkg = getPackagesForProduct(code).find((item) => item.id === productPackages[code]);
      return sum + (pkg?.monthlyValue || 0);
    }, 0);
  }, [productPackages, selectedProductCodes]);

  function toggleProduct(productCode: VyronProductCode) {
    setSelectedProducts((current) => ({ ...current, [productCode]: !current[productCode] }));
  }

  async function handleCreate() {
    setMessage(null);
    setError(null);

    if (!companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    if (!email.trim()) {
      setError("Primary admin email is required.");
      return;
    }
    const passwordError = validateClientLoginPassword(temporaryPassword, confirmTemporaryPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!selectedProductCodes.length) {
      setError("Select at least one VYRON product to prepare the client workspace.");
      return;
    }

    setProvisioning(true);
    try {
      let clientId = "";
      let loginWarning: string | null = null;

      if (onResolveCompanyId) {
        const resolved = await onResolveCompanyId({
          companyName: companyName.trim(),
          email: email.trim(),
          password: temporaryPassword,
          contactPerson: primaryContact.trim(),
          phone: phone.trim(),
          status,
        });
        if (!resolved?.companyId) {
          setError("Could not create the Supabase company workspace for this client.");
          return;
        }
        clientId = resolved.companyId;
        loginWarning = resolved.loginWarning || null;
      } else if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        clientId = crypto.randomUUID();
      } else {
        setError("Secure client ID generation is not available in this browser.");
        return;
      }

      const createdAt = new Date().toISOString();

      let next = provisionVyronClient(platformState, {
        clientId,
        companyName: companyName.trim(),
        tradingName: tradingName.trim() || companyName.trim(),
        industry: industry.trim() || "General",
        primaryContact: primaryContact.trim() || "—",
        email: email.trim(),
        phone: phone.trim() || "—",
        status,
        createdAt,
        subscriptionStatus: status === "trial" ? "trialing" : status === "suspended" ? "on-hold" : "active",
      });

      for (const productCode of selectedProductCodes) {
        const selectedPackageId = productPackages[productCode] || getPackagesForProduct(productCode)[0]?.id || null;
        next = setClientProductStatus(
          next,
          clientId,
          productCode,
          status === "trial" ? "trial" : status === "suspended" ? "suspended" : "enabled",
          selectedPackageId
        );
      }

      const clientRef = next.clientProfiles[clientId]?.clientRef || "";
      onPlatformStateChange(next);

      if (onProvisionClient) {
        await onProvisionClient({
          clientId,
          companyName: companyName.trim(),
          tradingName: tradingName.trim() || companyName.trim(),
          industry: industry.trim() || "General",
          primaryContact: primaryContact.trim() || "—",
          email: email.trim(),
          phone: phone.trim() || "—",
          status,
          createdAt,
          clientRef,
        });
      }

      let syncResult: "local" | "supabase" = "local";
      if (onSyncProvisionedClient) {
        syncResult = await onSyncProvisionedClient(clientId, next);
      }

      const syncMessage =
        syncResult === "supabase" ? "Client synced to Supabase." : "Client saved locally.";

      setMessage(
        `${clientRef} provisioned with ${selectedProductCodes.length} product workspace${selectedProductCodes.length === 1 ? "" : "s"} and package foundation records. ${syncMessage}${
          loginWarning ? ` ${loginWarning}` : ""
        }`
      );
      setCompanyName("");
      setTradingName("");
      setIndustry("General");
      setPrimaryContact("");
      setEmail("");
      setTemporaryPassword("");
      setConfirmTemporaryPassword("");
      setPhone("");
      setStatus("active");
      setSelectedProducts({
        CORE: true,
        COST: false,
        PAY: false,
        FARM: false,
        MAINT: false,
        REACH: false,
        FINANCE: false,
        BUILD: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provisioning failed.");
    } finally {
      setProvisioning(false);
    }
  }

  return (
    <div className="space-y-6">
      <VyronDevPanel>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">
              Client Provisioning Engine
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Client Workspace</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              Structured provisioning for vyron_clients, vyron_client_products, vyron_product_workspaces,
              vyron_product_packages and vyron_client_subscriptions. Phase 3 persists to Supabase when tables
              are available, with localStorage fallback.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-3xl border border-cyan-100 bg-cyan-50 px-5 py-4 text-sm font-black text-cyan-900">
              Estimated product value: R {selectedMonthlyValue.toLocaleString("en-ZA")} p/m
            </div>
            <div
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-black ${
                persistenceStatus === "supabase"
                  ? "bg-emerald-100 text-emerald-800"
                  : persistenceStatus === "syncing"
                    ? "bg-cyan-100 text-cyan-800"
                    : persistenceStatus === "error"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-700"
              }`}
            >
              {persistenceStatus === "supabase" ? (
                <Cloud className="h-3.5 w-3.5" />
              ) : (
                <CloudOff className="h-3.5 w-3.5" />
              )}
              Persistence: {persistenceStatus}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Company Name *
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Legal company name"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Trading Name
            <input
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Trading as name"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Industry
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800 outline-none focus:border-cyan-400"
            >
              {INDUSTRY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Primary Contact
            <input
              value={primaryContact}
              onChange={(e) => setPrimaryContact(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Full name"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Primary Admin Email *
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="admin@client.co.za"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Temporary Password *
            <input
              type="password"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Minimum 8 characters"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Confirm Temporary Password *
            <input
              type="password"
              value={confirmTemporaryPassword}
              onChange={(e) => setConfirmTemporaryPassword(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="Re-enter password"
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
              placeholder="+27 ..."
            />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as VyronDevClientStatus)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800 outline-none focus:border-cyan-400"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Created Date
            <input
              readOnly
              value={new Date().toLocaleString("en-ZA")}
              className="mt-2 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500"
            />
          </label>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Product Access</div>
            <h3 className="mt-2 text-xl font-bold">Initial products and packages</h3>
            <p className="mt-2 text-sm text-slate-500">
              Select the products to enable immediately. Each selected product creates a workspace record and package assignment.
            </p>
          </div>
          <div className="text-sm font-black text-slate-600">
            {selectedProductCodes.length} selected
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {VYRON_PRODUCT_CODES.map((code) => {
            const packages = getPackagesForProduct(code);
            return (
              <div
                key={code}
                className={`rounded-3xl border p-4 shadow-sm ${selectedProducts[code] ? productAccent(code) : "border-slate-200 bg-white text-slate-700"}`}
              >
                <label className="flex cursor-pointer items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-black">{code}</span>
                    <span className="block text-xs font-semibold opacity-80">{VYRON_PRODUCT_NAMES[code]}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedProducts[code]}
                    onChange={() => toggleProduct(code)}
                    className="mt-1 h-4 w-4 accent-cyan-600"
                  />
                </label>
                <select
                  value={productPackages[code] || packages[0]?.id || ""}
                  onChange={(e) => setProductPackages((current) => ({ ...current, [code]: e.target.value }))}
                  disabled={!selectedProducts[code]}
                  className="mt-4 w-full rounded-2xl border border-white/80 bg-white/85 px-3 py-2 text-xs font-black text-slate-800 outline-none disabled:opacity-50"
                >
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.packageName} · {formatVyronPackageMonthlyValue(pkg.monthlyValue, pkg.packageName)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        )}
        {message && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        )}

        <button
          type="button"
          disabled={provisioning}
          onClick={() => void handleCreate()}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#06101f] px-6 py-3 text-sm font-black text-cyan-300 shadow-lg disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {provisioning ? "Provisioning…" : "Create Client + Workspaces"}
        </button>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-700">Recent Clients</div>
            <h3 className="mt-1 text-lg font-bold">Provisioned register</h3>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                <th className="px-4 py-3">Client Ref</th>
                <th className="px-4 py-3">Company Name</th>
                <th className="px-4 py-3">Trading Name</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">Primary Contact</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created Date</th>
              </tr>
            </thead>
            <tbody>
              {recentClients.map((client) => (
                <tr key={client.id} className="rounded-2xl bg-white/90 shadow-sm">
                  <td className="px-4 py-4 font-mono text-xs font-black text-cyan-800">
                    {client.clientRef}
                  </td>
                  <td className="px-4 py-4 font-bold text-slate-950">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      {client.companyName}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-slate-700">{client.tradingName}</td>
                  <td className="px-4 py-4 text-slate-700">{client.industry}</td>
                  <td className="px-4 py-4 text-slate-700">{client.primaryContact}</td>
                  <td className="px-4 py-4 text-slate-700">{client.email}</td>
                  <td className="px-4 py-4 text-slate-700">{client.phone}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${statusBadgeClass(client.status)}`}>
                      {client.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600">
                    {new Date(client.registrationDate).toLocaleDateString("en-ZA")}
                  </td>
                </tr>
              ))}
              {recentClients.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                    No clients provisioned yet. Create the first VYRON client workspace above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </VyronDevPanel>

      <VyronDevPanel>
        <div className="flex items-start gap-3 text-sm text-slate-600">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-700" />
          <p>
            Phase 3 writes to Supabase when vyron_dev tables are migrated. If tables are missing or offline,
            provisioning continues safely with localStorage only — no unsafe authentication impersonation.
          </p>
        </div>
      </VyronDevPanel>
    </div>
  );
}
