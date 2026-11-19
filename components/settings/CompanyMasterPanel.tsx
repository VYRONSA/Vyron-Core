"use client";

/**
 * Company Master — the shared VYRON company identity.
 *
 * ONE RECORD, MANY MODULES
 *   public.companies is the platform's company master. CORE, HR, SAFETY and
 *   every future module reference it; none of them keeps its own copy. What is
 *   edited here is what a Safety report, an HR contract and a payroll export
 *   all print.
 *
 * AUTHORITY IS NEVER INFERRED
 *   Being a Safety owner, an HR user or a payroll user grants nothing here.
 *   Company Master authority is a CORE owner/admin/platform_admin role, or an
 *   explicit grant in vyron_company_master_admins, or the platform operator.
 *   The server decides: `can_edit` and `can_manage_admins` arrive from
 *   vyron_get_company() and are used to choose what to RENDER. Every action is
 *   re-authorised by the RPC it calls. Hiding a button is presentation, never
 *   protection.
 *
 * HONEST SAVES
 *   A save reports success only when the server says ok. Fields the server
 *   refused come back in `rejected` and are shown, rather than being folded
 *   into a success message the person would reasonably believe.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Building2, Check, ImageIcon, Loader2, Lock, Mail, MapPin,
  Save, ShieldCheck, UserPlus, X,
} from "lucide-react";
import {
  candidateLabel, companyLogoUrl, getCompanyMaster, grantCompanyMasterAdmin,
  grantCompanyMasterAdminByEmail, listCompanyMasterAdmins,
  listCompanyMasterCandidates, revokeCompanyMasterAdmin, updateCompanyMaster,
  uploadCompanyLogo, validateCompanyField,
  type CompanyMaster, type CompanyMasterAdmin, type CompanyMasterCandidate,
  type EditableCompanyField,
} from "@/lib/company-master";

/* ------------------------------------------------------------------ */

type FieldSpec = {
  key: EditableCompanyField;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  hint?: string;
};

const GROUPS: { title: string; icon: React.ReactNode; fields: FieldSpec[] }[] = [
  {
    title: "Company information",
    icon: <Building2 className="h-4 w-4" />,
    fields: [
      { key: "name", label: "Legal name", placeholder: "As registered", hint: "Required. Appears on issued documents." },
      { key: "trading_name", label: "Trading name", placeholder: "If different from the legal name" },
      { key: "registration_number", label: "Registration number", placeholder: "2019/123456/07" },
      { key: "vat_number", label: "VAT number", placeholder: "4123456789", hint: "South African VAT is 10 digits beginning with 4." },
      { key: "industry", label: "Industry", placeholder: "e.g. Occupational Health & Safety" },
    ],
  },
  {
    title: "Contact",
    icon: <Mail className="h-4 w-4" />,
    fields: [
      { key: "email", label: "General email", placeholder: "info@example.co.za", hint: "Separate from the billing address, which the platform controls." },
      { key: "phone", label: "Telephone", placeholder: "+27 21 000 0000" },
      { key: "website", label: "Website", placeholder: "https://example.co.za" },
      { key: "contact_person", label: "Primary contact", placeholder: "Full name" },
    ],
  },
  {
    title: "Addresses",
    icon: <MapPin className="h-4 w-4" />,
    fields: [
      { key: "physical_address", label: "Physical address", multiline: true, placeholder: "Street, suburb, city" },
      { key: "postal_address", label: "Postal address", multiline: true, placeholder: "PO Box or postal address" },
      { key: "address_line1", label: "Address line 1" },
      { key: "address_line2", label: "Address line 2" },
      { key: "address_city", label: "City" },
      { key: "address_region", label: "Province / region" },
      { key: "address_postal_code", label: "Postal code" },
      { key: "country", label: "Country", placeholder: "South Africa", hint: "Determines how the VAT number is validated." },
    ],
  },
];

const EDITABLE_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

type Draft = Partial<Record<EditableCompanyField, string>>;

const toDraft = (c: CompanyMaster): Draft => {
  const d: Draft = {};
  for (const k of EDITABLE_KEYS) d[k] = (c[k] as string | null) ?? "";
  return d;
};

/* ------------------------------------------------------------------ */

export default function CompanyMasterPanel({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<CompanyMaster | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");

  const [draft, setDraft] = useState<Draft>({});
  const [baseline, setBaseline] = useState<Draft>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EditableCompanyField, string>>>({});

  const [admins, setAdmins] = useState<CompanyMasterAdmin[]>([]);
  const [adminBusy, setAdminBusy] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminNotice, setAdminNotice] = useState("");

  /*
   * The people who may be offered the grant, and whether the lookup exists at
   * all. `null` means "not answered yet"; `false` means sql/099 is not applied
   * in this database, which is a different thing from a company with nobody to
   * offer and is shown as such.
   */
  const [candidates, setCandidates] = useState<CompanyMasterCandidate[]>([]);
  const [directoryAvailable, setDirectoryAvailable] = useState<boolean | null>(null);

  /** The selected candidate's auth user id. Never typed - always chosen. */
  const [grantChoice, setGrantChoice] = useState("");
  /** The by-address route, for somebody not associated with this company yet. */
  const [grantEmail, setGrantEmail] = useState("");
  const [emailFormOpen, setEmailFormOpen] = useState(false);
  /** Pre-099 fallback only: reachable when the directory lookup is absent. */
  const [grantId, setGrantId] = useState("");

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * Somebody who already holds the grant is not offered it again. Re-granting
   * would succeed - the RPC upserts - but a list that offers what is already
   * true invites a click that changes nothing and reads as a bug.
   */
  const grantableCandidates = useMemo(
    () => candidates.filter(
      (c) => !c.is_admin
        && !admins.some((a) => a.auth_user_id === c.auth_user_id && a.status === "active"),
    ),
    [candidates, admins],
  );

  const dirty = useMemo(
    () => EDITABLE_KEYS.some((k) => (draft[k] ?? "") !== (baseline[k] ?? "")),
    [draft, baseline],
  );

  /*
   * The load runs inside the effect rather than through a callback, so every
   * state write demonstrably happens after an await. `loading` starts true and
   * is only ever cleared. `cancelled` stops a slow response from a company the
   * user has already navigated away from overwriting the current one.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await getCompanyMaster(companyId);
        if (cancelled) return;
        setCompany(c);
        const d = toDraft(c);
        setDraft(d);
        setBaseline(d);
        const url = await companyLogoUrl(c);
        if (cancelled) return;
        setLogoUrl(url);
        if (c.can_manage_admins) {
          try {
            const list = await listCompanyMasterAdmins(companyId);
            if (!cancelled) setAdmins(list);
          } catch {
            /* Listing is a convenience; the screen works without it. */
          }
          try {
            const dir = await listCompanyMasterCandidates(companyId);
            if (!cancelled) {
              setCandidates(dir.candidates);
              setDirectoryAvailable(dir.available);
            }
          } catch {
            /* A refused or failed lookup is not an absent one. Treating it as
               absent would offer the UUID fallback to somebody who is simply
               not allowed to see the directory. */
            if (!cancelled) setDirectoryAvailable(true);
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  /* Unsaved-changes protection. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setField = (k: EditableCompanyField, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved("");
    setFieldErrors((f) => ({ ...f, [k]: undefined }));
  };

  const cancel = () => {
    /* Restore the snapshot rather than re-fetching: a slow network must not
       cost someone the text they typed while deciding to discard it. */
    setDraft(baseline);
    setFieldErrors({});
    setSaveError("");
    setRejected([]);
    setEditing(false);
  };

  async function save() {
    if (!company) return;
    const errs: Partial<Record<EditableCompanyField, string>> = {};
    for (const k of EDITABLE_KEYS) {
      const msg = validateCompanyField(k, draft[k] ?? "", draft.country ?? company.country);
      if (msg) errs[k] = msg;
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setSaveError("Some fields need attention before this can be saved.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaved("");
    setRejected([]);
    try {
      const patch: Partial<Record<EditableCompanyField, string | null>> = {};
      for (const k of EDITABLE_KEYS) {
        if ((draft[k] ?? "") !== (baseline[k] ?? "")) patch[k] = (draft[k] ?? "").trim() || null;
      }
      const res = await updateCompanyMaster(company.id, patch);

      if (!res.ok) {
        setSaveError("message" in res ? res.message : reasonText(res.reason));
        setRejected(res.rejected ?? []);
        return;
      }
      /* Read back, so "saved" means the server agrees, not that the call
         returned. */
      const fresh = await getCompanyMaster(company.id);
      setCompany(fresh);
      const d = toDraft(fresh);
      setDraft(d);
      setBaseline(d);
      setRejected(res.rejected);
      setSaved(res.fields.length ? `Saved: ${res.fields.join(", ")}.` : "No changes were needed.");
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file || !company) return;
    setLogoBusy(true);
    setSaveError("");
    try {
      const r = await uploadCompanyLogo(company.id, file);
      if (!r.ok) { setSaveError(r.message ?? "The logo could not be uploaded."); return; }
      const fresh = await getCompanyMaster(company.id);
      setCompany(fresh);
      setLogoUrl(await companyLogoUrl(fresh));
      setSaved("Logo updated.");
    } finally {
      setLogoBusy(false);
    }
  }

  /*
   * Re-reads both lists after any change.
   *
   * The screen shows what the server says, not what the click implied: a grant
   * that the RPC accepted and a grant that silently did nothing must not look
   * the same afterwards.
   */
  async function refreshAdmins(id: string) {
    setAdmins(await listCompanyMasterAdmins(id));
    try {
      const dir = await listCompanyMasterCandidates(id);
      setCandidates(dir.candidates);
      setDirectoryAvailable(dir.available);
    } catch {
      /* Leave the previous directory state alone rather than guessing. */
    }
  }

  /** Grant to the selected candidate. The id came from the server's own list. */
  async function doGrantSelected() {
    if (!company || !grantChoice) return;
    setAdminBusy("grant");
    setAdminError("");
    setAdminNotice("");
    const r = await grantCompanyMasterAdmin(company.id, grantChoice);
    if (!r.ok) setAdminError(r.message ?? "The grant was refused.");
    else {
      setGrantChoice("");
      setAdminNotice("Company Master administration granted.");
      await refreshAdmins(company.id);
    }
    setAdminBusy("");
  }

  /** Grant by exact email, for a person not yet associated with the company. */
  async function doGrantByEmail() {
    if (!company || !grantEmail.trim()) return;
    setAdminBusy("grant-email");
    setAdminError("");
    setAdminNotice("");
    const r = await grantCompanyMasterAdminByEmail(company.id, grantEmail);
    if (r.ok) {
      setGrantEmail("");
      setEmailFormOpen(false);
      setAdminNotice("Company Master administration granted.");
      await refreshAdmins(company.id);
    } else if (r.reason === "no_account") {
      setAdminError("No VYRON account uses that email address. Nothing was granted.");
    } else if (r.reason === "unavailable") {
      setAdminError("Granting by email address is not available in this environment.");
    } else {
      setAdminError(r.message ?? "The grant was refused.");
    }
    setAdminBusy("");
  }

  /* Pre-099 fallback. Kept so an environment without the directory lookup can
     still grant, rather than losing the capability the selector replaces. */
  async function doGrantById() {
    if (!company || !grantId.trim()) return;
    setAdminBusy("grant-id");
    setAdminError("");
    setAdminNotice("");
    const r = await grantCompanyMasterAdmin(company.id, grantId.trim());
    if (!r.ok) setAdminError(r.message ?? "The grant was refused.");
    else {
      setGrantId("");
      setAdminNotice("Company Master administration granted.");
      await refreshAdmins(company.id);
    }
    setAdminBusy("");
  }

  async function doRevoke(authUserId: string) {
    if (!company) return;
    setAdminBusy(authUserId);
    setAdminError("");
    setAdminNotice("");
    const r = await revokeCompanyMasterAdmin(company.id, authUserId);
    if (!r.ok) setAdminError(r.message ?? "The revocation was refused.");
    else await refreshAdmins(company.id);
    setAdminBusy("");
  }

  /**
   * How to name one person.
   *
   * The uuid is kept alongside the name rather than replaced by it: two people
   * can share a display name, and the uuid is what the grant actually points
   * at, so hiding it would make the row unverifiable.
   */
  function describeUser(authUserId: string): { title: string; sub: string | null } {
    const c = candidates.find((x) => x.auth_user_id === authUserId);
    if (!c) return { title: authUserId, sub: null };
    if (c.display_name && c.email) return { title: c.display_name, sub: c.email };
    return { title: c.display_name ?? c.email ?? authUserId, sub: null };
  }

  /* ---------------- states ---------------- */

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-3 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading company details…
        </div>
      </Card>
    );
  }

  if (loadError || !company) {
    /*
     * "Not found" and "not yours" are the same answer from the server, on
     * purpose: distinguishing them would confirm a company exists to someone
     * not entitled to know it. The wording here must not undo that.
     */
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <h2 className="text-base font-black text-white">Company details are not available to you</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
              This company could not be opened with your access. If you believe that is wrong,
              ask a company administrator or the VYRON platform operator to check your access.
            </p>
            {loadError && <p className="mt-3 font-mono text-xs text-white/40">{loadError}</p>}
          </div>
        </div>
      </Card>
    );
  }

  const readOnly = !company.can_edit || !editing;

  return (
    <div className="space-y-5">
      {/* ---------------- header ---------------- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <LogoBadge url={logoUrl} name={company.name} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                VYRON Company Master
              </p>
              <h1 className="mt-1 text-xl font-black text-white">{company.name ?? "Unnamed company"}</h1>
              {company.trading_name && (
                <p className="text-sm text-white/60">trading as {company.trading_name}</p>
              )}
              <p className="mt-2 font-mono text-[11px] text-white/35">{company.id}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {company.can_edit ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-200">
                <ShieldCheck className="h-3.5 w-3.5" /> Company Master administrator
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-bold text-white/60">
                <Lock className="h-3.5 w-3.5" /> Read only
              </span>
            )}
            {company.can_edit && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-900 transition hover:bg-white/85"
              >
                Edit company
              </button>
            )}
          </div>
        </div>

        {!company.can_edit && (
          <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-white/60">
            You can see this company&rsquo;s details but not change them. Company Master
            administration is granted explicitly and is separate from Safety, HR and payroll
            roles — holding one of those does not confer it. A company administrator or the
            platform operator can grant it.
          </p>
        )}
      </Card>

      {/* ---------------- feedback ---------------- */}
      {saved && (
        <Banner tone="ok" icon={<Check className="h-4 w-4" />}>{saved}</Banner>
      )}
      {rejected.length > 0 && (
        <Banner tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
          The server refused {rejected.length === 1 ? "one field" : `${rejected.length} fields`} and
          did not change {rejected.length === 1 ? "it" : "them"}: {rejected.join(", ")}. These are
          controlled by the VYRON platform, not by a company administrator.
        </Banner>
      )}
      {saveError && (
        <Banner tone="err" icon={<AlertTriangle className="h-4 w-4" />}>{saveError}</Banner>
      )}

      {/* ---------------- fields ---------------- */}
      {GROUPS.map((group) => (
        <Card key={group.title}>
          <div className="mb-4 flex items-center gap-2 text-white">
            {group.icon}
            <h2 className="text-sm font-black uppercase tracking-wide">{group.title}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {group.fields.map((f) => (
              <Field
                key={f.key}
                spec={f}
                value={draft[f.key] ?? ""}
                error={fieldErrors[f.key]}
                readOnly={readOnly}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>
        </Card>
      ))}

      {/* ---------------- branding ---------------- */}
      <Card>
        <div className="mb-4 flex items-center gap-2 text-white">
          <ImageIcon className="h-4 w-4" />
          <h2 className="text-sm font-black uppercase tracking-wide">Branding</h2>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <LogoBadge url={logoUrl} name={company.name} large />
          <div className="min-w-[260px] flex-1">
            <p className="text-sm text-white/70">
              The logo appears on documents generated across VYRON. It is stored privately and
              served through a short-lived signed link — never a public URL.
            </p>
            {company.can_edit && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  hidden
                  onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = ""; }}
                />
                <button
                  type="button"
                  disabled={logoBusy}
                  onClick={() => fileRef.current?.click()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  {logoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {logoUrl ? "Replace logo" : "Upload logo"}
                </button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------- administrators ---------------- */}
      {company.can_manage_admins && (
        <Card>
          <div className="mb-2 flex items-center gap-2 text-white">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-sm font-black uppercase tracking-wide">Company Master administrators</h2>
          </div>
          <p className="mb-4 max-w-3xl text-sm leading-relaxed text-white/60">
            Authority over this company&rsquo;s shared identity. It is deliberately separate from
            Safety, HR and payroll: granting it here gives a person no access to employee,
            payroll or module data, and creates no CORE membership.
          </p>

          {adminError && (
            <Banner tone="err" icon={<AlertTriangle className="h-4 w-4" />}>{adminError}</Banner>
          )}
          {adminNotice && (
            <Banner tone="ok" icon={<Check className="h-4 w-4" />}>{adminNotice}</Banner>
          )}

          <div className="mt-3 space-y-2">
            {admins.length === 0 && (
              <p className="text-sm text-white/50">
                No explicit administrators. Access is currently held through CORE roles or the
                platform operator.
              </p>
            )}
            {admins.map((a) => {
              const who = describeUser(a.auth_user_id);
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white/90">{who.title}</p>
                    {who.sub && <p className="truncate text-xs text-white/60">{who.sub}</p>}
                    {/* The uuid stays visible beneath the name. It is what the
                        grant points at, and two people can share a display
                        name. Suppressed when the name IS the uuid - a revoked
                        administrator no longer appears in the candidate list,
                        so there is nothing to resolve them to and printing it
                        twice would just look like a bug. */}
                    {who.title !== a.auth_user_id && (
                      <p className="mt-0.5 font-mono text-[10px] text-white/30">{a.auth_user_id}</p>
                    )}
                    <p className="text-[11px] text-white/45">
                      {a.status === "active" ? "Active" : "Revoked"}
                      {a.granted_at && ` · granted ${new Date(a.granted_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  {a.status === "active" && (
                    <button
                      type="button"
                      disabled={adminBusy === a.auth_user_id}
                      onClick={() => void doRevoke(a.auth_user_id)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-red-200 transition hover:bg-red-400/20 disabled:opacity-50"
                    >
                      {adminBusy === a.auth_user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---- add an administrator ---- */}
          <div className="mt-4 border-t border-white/10 pt-4">
            {directoryAvailable === null && (
              <p className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the people you can choose from…
              </p>
            )}

            {/*
              The selector. Options come from the server's own candidate list,
              so an id can only be chosen, never composed: there is no text
              input here that a uuid could be typed into.
            */}
            {directoryAvailable === true && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-[300px] flex-1">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/50">
                      Add an administrator
                    </span>
                    <select
                      value={grantChoice}
                      onChange={(e) => setGrantChoice(e.target.value)}
                      disabled={grantableCandidates.length === 0}
                      className="w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">
                        {grantableCandidates.length === 0
                          ? "Nobody else is associated with this company"
                          : "Choose a person…"}
                      </option>
                      {grantableCandidates.map((c) => (
                        <option key={c.auth_user_id} value={c.auth_user_id}>
                          {candidateLabel(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!grantChoice || adminBusy === "grant"}
                    onClick={() => void doGrantSelected()}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-900 transition hover:bg-white/85 disabled:opacity-40"
                  >
                    {adminBusy === "grant" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    Grant
                  </button>
                </div>

                <p className="mt-2 text-[11px] text-white/35">
                  Only people already working with this company are listed. Nobody from another
                  company appears here, and being listed grants nothing on its own.
                </p>

                {/*
                  The one case a candidate list cannot cover: somebody who holds
                  a VYRON account but has no association with this company yet -
                  which is how a company's first administrator is appointed.
                */}
                {!emailFormOpen && (
                  <button
                    type="button"
                    onClick={() => setEmailFormOpen(true)}
                    className="mt-3 text-[11px] font-bold uppercase tracking-wide text-cyan-300 underline-offset-4 hover:underline"
                  >
                    Someone not listed? Grant by email address
                  </button>
                )}

                {emailFormOpen && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[260px] flex-1">
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/50">
                          Email address of an existing VYRON account
                        </span>
                        <input
                          type="email"
                          value={grantEmail}
                          onChange={(e) => setGrantEmail(e.target.value)}
                          placeholder="person@example.co.za"
                          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/40 focus:outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!grantEmail.trim() || adminBusy === "grant-email"}
                        onClick={() => void doGrantByEmail()}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-900 transition hover:bg-white/85 disabled:opacity-40"
                      >
                        {adminBusy === "grant-email" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                        Grant
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEmailFormOpen(false); setGrantEmail(""); }}
                        className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-white/20"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-white/35">
                      The address must match an existing account exactly. No account is created
                      here, and an address that matches nobody is reported rather than ignored.
                    </p>
                  </div>
                )}
              </>
            )}

            {/*
              Pre-099 fallback.
              A database without vyron_list_company_master_candidates() has no
              directory to select from. Saying so and offering the old entry is
              better than an empty dropdown, which would look like a company
              with nobody in it and would silently remove the ability to grant.
            */}
            {directoryAvailable === false && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                <p className="text-sm font-bold text-amber-100">
                  Administrator lookup is not available in this environment
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
                  sql/099 has not been applied to this database, so people cannot be listed by
                  name. Granting still works by auth user ID, and is still authorised by the
                  same Company Master check.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="min-w-[280px] flex-1">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/50">
                      Grant to user ID
                    </span>
                    <input
                      value={grantId}
                      onChange={(e) => setGrantId(e.target.value)}
                      placeholder="auth user UUID"
                      className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/40 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!grantId.trim() || adminBusy === "grant-id"}
                    onClick={() => void doGrantById()}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-900 transition hover:bg-white/85 disabled:opacity-40"
                  >
                    {adminBusy === "grant-id" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    Grant
                  </button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ---------------- save bar ---------------- */}
      {company.can_edit && editing && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-slate-900/95 px-5 py-4 shadow-2xl backdrop-blur">
          <p className="text-sm text-white/70">
            {dirty ? "You have unsaved changes." : "No changes yet."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-white/20 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-black uppercase tracking-wide text-slate-900 transition hover:bg-white/85 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save changes
            </button>
          </div>
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-white/35">
        Company identity is shared across VYRON. Changes here are used by CORE, HR, Payroll and
        Safety. Subscription, plan, limits and billing are controlled by the VYRON platform and
        cannot be changed from this screen.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentational helpers                                              */
/* ------------------------------------------------------------------ */

function reasonText(reason: string): string {
  switch (reason) {
    case "no_editable_fields":
      return "None of those fields can be changed from here — they are controlled by the VYRON platform.";
    case "no_changes":
      return "Nothing had changed, so nothing was saved.";
    default:
      return "The change was refused.";
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:p-6">
      {children}
    </section>
  );
}

function Banner({
  tone, icon, children,
}: { tone: "ok" | "warn" | "err"; icon: React.ReactNode; children: React.ReactNode }) {
  const styles = {
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    err: "border-red-400/30 bg-red-400/10 text-red-100",
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function Field({
  spec, value, error, readOnly, onChange,
}: {
  spec: FieldSpec;
  value: string;
  error?: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  const shared =
    "w-full rounded-lg border px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none " +
    (readOnly
      ? "border-white/10 bg-white/[0.03] text-white/70"
      : "border-white/15 bg-white/5 focus:border-white/40") +
    (error ? " border-red-400/60" : "");

  return (
    <label className={spec.multiline ? "md:col-span-2" : undefined}>
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/50">
        {spec.label}
      </span>
      {spec.multiline ? (
        <textarea
          rows={2}
          value={value}
          readOnly={readOnly}
          placeholder={readOnly ? "" : spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
        />
      ) : (
        <input
          value={value}
          readOnly={readOnly}
          placeholder={readOnly ? "" : spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={shared}
        />
      )}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-300">{error}</span>
      ) : spec.hint && !readOnly ? (
        <span className="mt-1 block text-[11px] text-white/35">{spec.hint}</span>
      ) : null}
      {readOnly && !value && (
        <span className="mt-1 block text-[11px] text-white/25">Not recorded</span>
      )}
    </label>
  );
}

function LogoBadge({
  url, name, large,
}: { url: string | null; name: string | null; large?: boolean }) {
  const size = large ? "h-24 w-24" : "h-14 w-14";
  if (url) {
    return (
      // A signed URL, minted per view and short-lived. next/image would proxy
      // and cache it, which is the wrong behaviour for a link that is meant to
      // expire, so a plain img is correct here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${name ?? "Company"} logo`}
        className={`${size} shrink-0 rounded-xl border border-white/15 bg-white/5 object-contain p-1.5`}
      />
    );
  }
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/5`}>
      <Building2 className={large ? "h-8 w-8 text-white/25" : "h-5 w-5 text-white/25"} />
    </div>
  );
}
