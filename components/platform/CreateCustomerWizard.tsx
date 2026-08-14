"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import { CUSTOMER_ROLE_OPTIONS, type CustomerRole } from "@/lib/tenant/user-roles";
import {
  PASSWORD_POLICY_DESCRIPTION,
  validatePassword,
  type PasswordMode,
} from "@/lib/tenant/password-policy";
import PlatformPanel from "./PlatformPanel";

type PlanOption = { id: string; code: string; name: string; modules: string[]; employee_limit: number | null; storage_limit_gb: number | null; ai_credit_limit: number | null; api_request_limit: number | null };
type TemplateOption = { id: string; code: string; name: string; description: string | null; default_modules: string[] | null };
type ModuleOption = { module_code: string; name: string; status: string; requires_enterprise: boolean; requires_ai_credits: boolean };

const STEPS = [
  "Industry",
  "Subscription Plan",
  "Enabled Modules",
  "Licence Limits",
  "Administrator",
  "Review",
] as const;

export default function CreateCustomerWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [modulesTouched, setModulesTouched] = useState(false);

  const [form, setForm] = useState({
    companyName: "",
    tradingName: "",
    industry: "",
    companySize: "",
    country: "South Africa",
    currency: "ZAR",
    timeZone: "Africa/Johannesburg",
    solutionTemplateCode: "",
    planCode: "",
    employeeLimit: "",
    userLimit: "",
    storageLimitGb: "",
    aiCreditLimit: "",
    apiRequestLimit: "",
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
    adminMobile: "",
    adminRole: "owner" as CustomerRole,
    adminActive: true,
    adminPasswordMode: "generate" as PasswordMode,
    adminPassword: "",
    adminConfirmPassword: "",
  });
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [provisionedCompanyId, setProvisionedCompanyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [plansResult, templatesResult, modulesResult] = await Promise.all([
        platformFetch<{ plans: PlanOption[] }>("/api/platform/plans"),
        platformFetch<{ templates: TemplateOption[] }>("/api/platform/templates"),
        platformFetch<{ modules: ModuleOption[] }>("/api/platform/modules"),
      ]);
      if (plansResult.ok) setPlans(plansResult.data.plans);
      if (templatesResult.ok) setTemplates(templatesResult.data.templates);
      if (modulesResult.ok) setModules(modulesResult.data.modules.filter((m) => m.status !== "hidden"));
    })();
  }, []);

  const selectedPlan = plans.find((p) => p.code === form.planCode);
  const selectedTemplate = templates.find((t) => t.code === form.solutionTemplateCode);

  const suggestedModules = useMemo(() => {
    const set = new Set<string>(selectedPlan?.modules || []);
    for (const moduleCode of selectedTemplate?.default_modules || []) set.add(moduleCode);
    return set;
  }, [selectedPlan, selectedTemplate]);
  const suggestedModulesKey = useMemo(() => Array.from(suggestedModules).sort().join(","), [suggestedModules]);
  const [appliedModulesKey, setAppliedModulesKey] = useState(suggestedModulesKey);

  // Auto-apply suggested modules whenever plan/template changes, unless the operator has manually edited the set.
  if (!modulesTouched && suggestedModulesKey !== appliedModulesKey) {
    setAppliedModulesKey(suggestedModulesKey);
    setSelectedModules(new Set(suggestedModules));
  }

  useEffect(() => {
    if (!form.employeeLimit && selectedPlan?.employee_limit != null) {
      update("employeeLimit", String(selectedPlan.employee_limit));
    }
    if (!form.storageLimitGb && selectedPlan?.storage_limit_gb != null) {
      update("storageLimitGb", String(selectedPlan.storage_limit_gb));
    }
    if (!form.aiCreditLimit && selectedPlan?.ai_credit_limit != null) {
      update("aiCreditLimit", String(selectedPlan.ai_credit_limit));
    }
    if (!form.apiRequestLimit && selectedPlan?.api_request_limit != null) {
      update("apiRequestLimit", String(selectedPlan.api_request_limit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleModule(code: string) {
    setModulesTouched(true);
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function goNext() {
    setError(null);
    if (step === 0 && !form.companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    if (step === 1 && !form.planCode) {
      setError("Choose a subscription plan.");
      return;
    }
    if (step === 4 && (!form.adminFirstName || !form.adminLastName || !form.adminEmail)) {
      setError("Administrator name and email are required.");
      return;
    }
    if (step === 4 && form.adminPasswordMode === "manual") {
      const validation = validatePassword(form.adminPassword, form.adminConfirmPassword);
      if (!validation.ok) {
        setError(validation.message);
        return;
      }
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleProvision() {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setTemporaryPassword(null);

    const result = await platformFetch<{
      companyId: string;
      companyName: string;
      temporaryPassword?: string;
      notices?: string[];
    }>(
      "/api/platform/customers",
      {
        method: "POST",
        body: JSON.stringify({
          companyName: form.companyName,
          tradingName: form.tradingName || undefined,
          industry: form.industry || undefined,
          companySize: form.companySize || undefined,
          country: form.country || undefined,
          currency: form.currency || undefined,
          timeZone: form.timeZone || undefined,
          planCode: form.planCode,
          solutionTemplateCode: form.solutionTemplateCode || null,
          enabledModules: Array.from(selectedModules),
          employeeLimit: form.employeeLimit === "" ? null : Number(form.employeeLimit),
          userLimit: form.userLimit === "" ? null : Number(form.userLimit),
          storageLimitGb: form.storageLimitGb === "" ? null : Number(form.storageLimitGb),
          aiCreditLimit: form.aiCreditLimit === "" ? null : Number(form.aiCreditLimit),
          apiRequestLimit: form.apiRequestLimit === "" ? null : Number(form.apiRequestLimit),
          adminFirstName: form.adminFirstName,
          adminLastName: form.adminLastName,
          adminEmail: form.adminEmail,
          adminMobile: form.adminMobile || undefined,
          adminRole: form.adminRole,
          adminActive: form.adminActive,
          adminPasswordMode: form.adminPasswordMode,
          adminPassword:
            form.adminPasswordMode === "manual" ? form.adminPassword : undefined,
          adminConfirmPassword:
            form.adminPasswordMode === "manual" ? form.adminConfirmPassword : undefined,
          // The administrator inherits the module set just provisioned for the company.
          adminModules: null,
        }),
      }
    );

    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    const notices = result.data.notices || [];
    setSuccess(
      [`${result.data.companyName} created.`, ...notices].join(" ")
    );

    // A generated password exists only in this response. Hold the operator on the page
    // until they dismiss it rather than navigating away and losing it.
    if (result.data.temporaryPassword) {
      setTemporaryPassword(result.data.temporaryPassword);
      setProvisionedCompanyId(result.data.companyId);
      return;
    }

    setTimeout(() => router.push(`/platform/customers/${result.data.companyId}`), 900);
  }

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-cyan-500";
  const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";

  return (
    <div className="flex flex-col gap-6">
      <PlatformPanel>
        <div className="flex flex-wrap items-center gap-2">
          {STEPS.map((label, index) => (
            <React.Fragment key={label}>
              <div
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black ${
                  index === step ? "bg-[#06101f] text-white" : index < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                }`}
              >
                {index < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                {index + 1}. {label}
              </div>
              {index < STEPS.length - 1 ? <div className="h-px w-4 bg-slate-200" /> : null}
            </React.Fragment>
          ))}
        </div>
      </PlatformPanel>

      {step === 0 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Company Information & Industry</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Company Name *</span>
              <input className={inputClass} value={form.companyName} onChange={(e) => update("companyName", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Trading Name</span>
              <input className={inputClass} value={form.tradingName} onChange={(e) => update("tradingName", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Company Size</span>
              <input className={inputClass} placeholder="e.g. 50-100 employees" value={form.companySize} onChange={(e) => update("companySize", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Country</span>
              <input className={inputClass} value={form.country} onChange={(e) => update("country", e.target.value)} />
            </label>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => {
              const selected = form.solutionTemplateCode === template.code;
              return (
                <button
                  type="button"
                  key={template.code}
                  onClick={() => {
                    const next = selected ? "" : template.code;
                    update("solutionTemplateCode", next);
                    if (!form.industry || selected === false) update("industry", template.name);
                    setModulesTouched(false);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{template.name}</span>
                    {selected ? <CheckCircle2 className="h-4 w-4 text-cyan-600" /> : null}
                  </div>
                  {template.description ? <p className="mt-1 text-xs text-slate-500">{template.description}</p> : null}
                </button>
              );
            })}
          </div>
        </PlatformPanel>
      ) : null}

      {step === 1 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Subscription Plan</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const selected = form.planCode === plan.code;
              return (
                <button
                  type="button"
                  key={plan.code}
                  onClick={() => {
                    update("planCode", plan.code);
                    setModulesTouched(false);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="font-bold text-slate-900">{plan.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {plan.employee_limit ? `${plan.employee_limit} employees` : "Unlimited employees"}
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => update("planCode", "custom")}
              className={`rounded-2xl border p-4 text-left transition ${
                form.planCode === "custom" ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="font-bold text-slate-900">Custom</div>
              <div className="mt-1 text-xs text-slate-500">Hand-pick modules and limits</div>
            </button>
          </div>
        </PlatformPanel>
      ) : null}

      {step === 2 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Enabled Modules</h2>
          <p className="mt-2 text-sm text-slate-600">Pre-selected from the chosen plan and industry template — adjust as needed.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((moduleOption) => {
              const selected = selectedModules.has(moduleOption.module_code);
              return (
                <button
                  type="button"
                  key={moduleOption.module_code}
                  onClick={() => toggleModule(moduleOption.module_code)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected ? "border-cyan-500 bg-cyan-50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{moduleOption.name}</span>
                    {selected ? <CheckCircle2 className="h-4 w-4 text-cyan-600" /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {moduleOption.status !== "enabled" ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-700">{moduleOption.status}</span>
                    ) : null}
                    {moduleOption.requires_enterprise ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">Enterprise</span>
                    ) : null}
                    {moduleOption.requires_ai_credits ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700">AI Credits</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </PlatformPanel>
      ) : null}

      {step === 3 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Licence Limits</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Employees (blank = unlimited)</span>
              <input className={inputClass} type="number" value={form.employeeLimit} onChange={(e) => update("employeeLimit", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Users</span>
              <input className={inputClass} type="number" value={form.userLimit} onChange={(e) => update("userLimit", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Storage (GB)</span>
              <input className={inputClass} type="number" value={form.storageLimitGb} onChange={(e) => update("storageLimitGb", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>AI Credits</span>
              <input className={inputClass} type="number" value={form.aiCreditLimit} onChange={(e) => update("aiCreditLimit", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>API Requests</span>
              <input className={inputClass} type="number" value={form.apiRequestLimit} onChange={(e) => update("apiRequestLimit", e.target.value)} />
            </label>
          </div>
        </PlatformPanel>
      ) : null}

      {step === 4 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Primary Administrator</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>First Name *</span>
              <input className={inputClass} value={form.adminFirstName} onChange={(e) => update("adminFirstName", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Last Name *</span>
              <input className={inputClass} value={form.adminLastName} onChange={(e) => update("adminLastName", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Email *</span>
              <input type="email" className={inputClass} value={form.adminEmail} onChange={(e) => update("adminEmail", e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Mobile</span>
              <input className={inputClass} value={form.adminMobile} onChange={(e) => update("adminMobile", e.target.value)} />
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Role *</span>
              <select
                className={inputClass}
                value={form.adminRole}
                onChange={(e) => update("adminRole", e.target.value as CustomerRole)}
              >
                {CUSTOMER_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">
                {CUSTOMER_ROLE_OPTIONS.find((option) => option.value === form.adminRole)?.description}
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Status</span>
              <select
                className={inputClass}
                value={form.adminActive ? "active" : "inactive"}
                onChange={(e) => update("adminActive", e.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <div className="mt-6">
            <span className={labelClass}>Initial Password</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["generate", "Generate temporary password"],
                  ["manual", "Set password manually"],
                  ["invite", "Send invitation email"],
                ] as [PasswordMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => update("adminPasswordMode", mode)}
                  className={`rounded-full px-4 py-2 text-xs font-black ${
                    form.adminPasswordMode === mode
                      ? "bg-[#06101f] text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {form.adminPasswordMode === "manual" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Password *</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.adminPassword}
                    onChange={(e) => update("adminPassword", e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Confirm Password *</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.adminConfirmPassword}
                    onChange={(e) => update("adminConfirmPassword", e.target.value)}
                  />
                </label>
                <p className="text-xs text-slate-500 md:col-span-2">{PASSWORD_POLICY_DESCRIPTION}</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                {form.adminPasswordMode === "generate"
                  ? "A strong password is generated on the server, set on the Supabase Auth account, and shown to you once on the next screen. It is never stored."
                  : "The administrator receives an invitation email and chooses their own password."}
              </p>
            )}
          </div>

          <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
            The administrator is created as a real Supabase Auth user and bound to this company
            only. Platform Console access is a separate, VYRON-internal privilege and is never
            granted here.
          </p>
        </PlatformPanel>
      ) : null}

      {step === 5 ? (
        <PlatformPanel>
          <h2 className="text-xl font-black text-[#06101f]">Review & Provision</h2>
          <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
            <div><div className={labelClass}>Company</div><div className="font-bold text-slate-800">{form.companyName}</div></div>
            <div><div className={labelClass}>Industry Template</div><div className="font-bold text-slate-800">{selectedTemplate?.name || "None"}</div></div>
            <div><div className={labelClass}>Plan</div><div className="font-bold text-slate-800">{selectedPlan?.name || "Custom"}</div></div>
            <div><div className={labelClass}>Modules</div><div className="font-bold text-slate-800">{selectedModules.size} enabled</div></div>
            <div><div className={labelClass}>Employee Limit</div><div className="font-bold text-slate-800">{form.employeeLimit || "Unlimited"}</div></div>
            <div><div className={labelClass}>Administrator</div><div className="font-bold text-slate-800">{form.adminFirstName} {form.adminLastName} ({form.adminEmail})</div></div>
          </div>

          <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
            <div>
              <div className={labelClass}>Administrator Role</div>
              <div className="font-bold text-slate-800">
                {CUSTOMER_ROLE_OPTIONS.find((option) => option.value === form.adminRole)?.label}
              </div>
            </div>
            <div>
              <div className={labelClass}>Initial Password</div>
              <div className="font-bold text-slate-800">
                {form.adminPasswordMode === "generate"
                  ? "Generated temporary password"
                  : form.adminPasswordMode === "manual"
                    ? "Set manually by operator"
                    : "Invitation email"}
              </div>
            </div>
          </div>

          {error ? <p className="mt-4 text-sm font-bold text-rose-700">{error}</p> : null}
          {success ? <p className="mt-4 text-sm font-bold text-emerald-700">{success}</p> : null}

          {temporaryPassword ? (
            <div className="mt-5 rounded-[24px] border border-amber-300 bg-amber-50 p-5">
              <div className="text-sm font-black text-amber-900">
                Temporary password for {form.adminEmail}
              </div>
              <p className="mt-1 text-xs text-amber-800">
                Shown once and not stored anywhere. Copy it now and share it securely — the
                administrator will be asked to change it.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <code className="select-all rounded-xl border border-amber-300 bg-white px-4 py-2 font-mono text-sm font-bold text-slate-900">
                  {temporaryPassword}
                </code>
                <button
                  type="button"
                  className="rounded-full border border-amber-400 px-4 py-2 text-xs font-black text-amber-900"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(temporaryPassword);
                      setCopiedPassword(true);
                    } catch {
                      setCopiedPassword(false);
                    }
                  }}
                >
                  {copiedPassword ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-[#06101f] px-5 py-2 text-xs font-black text-white"
                  onClick={() =>
                    router.push(`/platform/customers/${provisionedCompanyId ?? ""}`)
                  }
                >
                  Continue to customer
                </button>
              </div>
            </div>
          ) : null}

          {!temporaryPassword ? (
            <button
              type="button"
              onClick={handleProvision}
              disabled={submitting}
              className="mt-6 rounded-full bg-[#06101f] px-8 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? "Provisioning customer…" : "Provision Customer"}
            </button>
          ) : null}
        </PlatformPanel>
      ) : null}

      {error && step !== 5 ? <p className="text-sm font-bold text-rose-700">{error}</p> : null}

      {step !== 5 ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-white"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
