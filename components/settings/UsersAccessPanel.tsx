"use client";

/**
 * Users & Access — the single user-management screen.
 *
 * Rendered in two places against two different endpoints:
 *   Settings → Users & Access            → /api/company/users
 *   Platform Console → Customer → Users  → /api/platform/customers/:id/users
 *
 * Everything shown here is advisory. The capability flags (canEdit / canDelete /
 * canResetPassword / canChangeStatus), the role list and the module list all arrive
 * from the server, and every action is re-authorised server-side in
 * lib/tenant/user-management.ts. Hiding a button is presentation, never protection.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { authFetch } from "@/lib/authenticated-api-client";
import { MODULE_PERMISSION_LEVELS } from "@/lib/tenant/user-roles";
import { PASSWORD_POLICY_DESCRIPTION } from "@/lib/tenant/password-policy";

type PermissionLevel = (typeof MODULE_PERMISSION_LEVELS)[number];

export type CompanyUser = {
  id: string;
  userId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  mobile: string | null;
  role: string;
  roleLabel: string;
  status: "active" | "pending" | "inactive" | "deleted";
  lastLoginAt: string | null;
  createdAt: string | null;
  invitedAt: string | null;
  mustChangePassword: boolean;
  modules: string[];
  moduleLabels: string[];
  moduleAccessMode: "all" | "custom";
  permissions: Record<string, PermissionLevel[]>;
  accessSummary: string;
  isSelf: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canResetPassword: boolean;
  canChangeStatus: boolean;
};

type Directory = {
  company: { id: string; name: string; userLimit: number | null; customerStatus: string | null };
  availableModules: { code: string; label: string }[];
  roleOptions: { value: string; label: string; description: string }[];
  users: CompanyUser[];
  activeUserCount: number;
  seatLimitReached: boolean;
  actor: { email: string; role: string; platformOperator: boolean; canManage: boolean };
};

type PasswordMode = "invite" | "manual" | "generate";

const STATUS_TONE: Record<CompanyUser["status"], string> = {
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  inactive: "bg-slate-200 text-slate-700",
  deleted: "bg-rose-100 text-rose-700",
};

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-cyan-500";
const labelClass = "text-xs font-black uppercase tracking-wide text-slate-500";
const primaryButton =
  "inline-flex items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60";
const ghostButton =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return value.slice(0, 16).replace("T", " ");
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ${className}`}
    >
      {children}
    </section>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-3xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-xl font-black text-[#06101f]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** Shown exactly once — the server does not keep a copy and cannot show it again. */
function TemporaryPasswordNotice({
  email,
  password,
  onDismiss,
}: {
  email: string;
  password: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-[24px] border border-amber-300 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
        <div className="flex-1">
          <div className="text-sm font-black text-amber-900">
            Temporary password for {email}
          </div>
          <p className="mt-1 text-xs text-amber-800">
            This is shown once and is not stored anywhere. Copy it now and share it through a
            secure channel — the user will be asked to change it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="select-all rounded-xl border border-amber-300 bg-white px-4 py-2 font-mono text-sm font-bold text-slate-900">
              {password}
            </code>
            <button
              type="button"
              className={ghostButton}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(password);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={ghostButton} onClick={onDismiss}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleAccessEditor({
  availableModules,
  mode,
  setMode,
  selected,
  toggleModule,
  permissions,
  togglePermission,
}: {
  availableModules: { code: string; label: string }[];
  mode: "all" | "custom";
  setMode: (mode: "all" | "custom") => void;
  selected: Set<string>;
  toggleModule: (code: string) => void;
  permissions: Record<string, PermissionLevel[]>;
  togglePermission: (code: string, level: PermissionLevel) => void;
}) {
  if (availableModules.length === 0) {
    return (
      <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
        This company&apos;s subscription has no modules enabled yet, so there is nothing to grant.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("all")}
          className={`rounded-full px-4 py-2 text-xs font-black ${
            mode === "all" ? "bg-[#06101f] text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          All subscribed modules
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`rounded-full px-4 py-2 text-xs font-black ${
            mode === "custom" ? "bg-[#06101f] text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          Choose modules
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Only modules included in this company&apos;s subscription can be granted. The server rejects
        anything outside it.
      </p>

      {mode === "custom" ? (
        <div className="mt-4 space-y-3">
          {availableModules.map((moduleOption) => {
            const active = selected.has(moduleOption.code);
            const levels = permissions[moduleOption.code] || [];
            return (
              <div
                key={moduleOption.code}
                className={`rounded-2xl border p-4 transition ${
                  active ? "border-cyan-500 bg-cyan-50/60" : "border-slate-200 bg-white"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleModule(moduleOption.code)}
                  />
                  <span className="font-bold text-slate-900">{moduleOption.label}</span>
                </label>

                {active ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {MODULE_PERMISSION_LEVELS.map((level) => {
                      const on = levels.includes(level);
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => togglePermission(moduleOption.code, level)}
                          className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide transition ${
                            on
                              ? "bg-cyan-600 text-white"
                              : "bg-white text-slate-500 ring-1 ring-slate-200"
                          }`}
                        >
                          {level}
                        </button>
                      );
                    })}
                    {levels.length === 0 ? (
                      <span className="self-center text-[11px] text-slate-500">
                        No override — the role default applies.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  role: string;
  active: boolean;
  passwordMode: PasswordMode;
  password: string;
  confirmPassword: string;
  moduleMode: "all" | "custom";
  modules: Set<string>;
  permissions: Record<string, PermissionLevel[]>;
};

function emptyForm(defaultRole: string): FormState {
  return {
    firstName: "",
    lastName: "",
    email: "",
    mobile: "",
    role: defaultRole,
    active: true,
    passwordMode: "generate",
    password: "",
    confirmPassword: "",
    moduleMode: "all",
    modules: new Set<string>(),
    permissions: {},
  };
}

function formFromUser(user: CompanyUser): FormState {
  return {
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email,
    mobile: user.mobile || "",
    role: user.role,
    active: user.status === "active",
    passwordMode: "generate",
    password: "",
    confirmPassword: "",
    moduleMode: user.moduleAccessMode,
    modules: new Set(user.modules),
    permissions: { ...user.permissions },
  };
}

export default function UsersAccessPanel({
  endpoint,
  heading = "Users & Access",
  subheading,
}: {
  /** Base collection URL, e.g. "/api/company/users". */
  endpoint: string;
  heading?: string;
  subheading?: string;
}) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyUser | null>(null);
  const [resetting, setResetting] = useState<CompanyUser | null>(null);
  const [deleting, setDeleting] = useState<CompanyUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm("employee"));
  const [formError, setFormError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<"generate" | "manual">("generate");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  const load = useCallback(
    async (withRemoved: boolean) => {
      const response = await authFetch(`${endpoint}${withRemoved ? "?includeDeleted=1" : ""}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setLoadError(payload?.message || `Could not load users (${response.status}).`);
        return;
      }
      setDirectory(payload as Directory);
      setLoadError(null);
    },
    [endpoint]
  );

  useEffect(() => {
    (async () => {
      await load(showRemoved);
    })();
  }, [load, showRemoved]);

  const visibleUsers = useMemo(() => {
    const users = directory?.users || [];
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [user.fullName, user.email, user.roleLabel, user.mobile || ""]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [directory, search]);

  const availableModules = directory?.availableModules || [];
  const roleOptions = directory?.roleOptions || [];
  const canManage = directory?.actor.canManage ?? false;

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFormModule(code: string) {
    setForm((prev) => {
      const modules = new Set(prev.modules);
      if (modules.has(code)) modules.delete(code);
      else modules.add(code);
      return { ...prev, modules };
    });
  }

  function toggleFormPermission(code: string, level: PermissionLevel) {
    setForm((prev) => {
      const current = prev.permissions[code] || [];
      const next = current.includes(level)
        ? current.filter((entry) => entry !== level)
        : [...current, level];
      const permissions = { ...prev.permissions };
      if (next.length === 0) delete permissions[code];
      else permissions[code] = MODULE_PERMISSION_LEVELS.filter((entry) => next.includes(entry));
      return { ...prev, permissions };
    });
  }

  async function send(
    path: string,
    init: RequestInit
  ): Promise<{ ok: boolean; payload: Record<string, unknown> }> {
    const response = await authFetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok && payload.ok === true, payload };
  }

  function modulePayload(state: FormState): string[] | null {
    return state.moduleMode === "all" ? null : Array.from(state.modules);
  }

  function permissionPayload(state: FormState): Record<string, PermissionLevel[]> {
    if (state.moduleMode === "all") return state.permissions;
    const allowed = new Set(state.modules);
    const result: Record<string, PermissionLevel[]> = {};
    for (const [code, levels] of Object.entries(state.permissions)) {
      if (allowed.has(code)) result[code] = levels;
    }
    return result;
  }

  async function handleCreate() {
    setFormError(null);
    setBusy(true);

    const { ok, payload } = await send(endpoint, {
      method: "POST",
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        mobile: form.mobile,
        role: form.role,
        status: form.active ? "active" : "inactive",
        passwordMode: form.passwordMode,
        password: form.passwordMode === "manual" ? form.password : undefined,
        confirmPassword: form.passwordMode === "manual" ? form.confirmPassword : undefined,
        modules: modulePayload(form),
        permissions: permissionPayload(form),
      }),
    });

    setBusy(false);
    if (!ok) {
      setFormError(String(payload.message || "The user could not be created."));
      return;
    }

    setCreateOpen(false);
    if (typeof payload.temporaryPassword === "string") {
      setTempPassword({ email: form.email.trim().toLowerCase(), password: payload.temporaryPassword });
    }
    const notices = Array.isArray(payload.notices) ? (payload.notices as string[]) : [];
    setBanner({
      tone: "ok",
      text: notices.length > 0 ? notices.join(" ") : `${form.email} was added.`,
    });
    await load(showRemoved);
  }

  async function handleUpdate() {
    if (!editing) return;
    setFormError(null);
    setBusy(true);

    const { ok, payload } = await send(`${endpoint}/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        mobile: form.mobile,
        role: form.role,
        status: form.active ? "active" : "inactive",
        modules: modulePayload(form),
        permissions: permissionPayload(form),
      }),
    });

    setBusy(false);
    if (!ok) {
      setFormError(String(payload.message || "The user could not be updated."));
      return;
    }

    setEditing(null);
    const notices = Array.isArray(payload.notices) ? (payload.notices as string[]) : [];
    setBanner({ tone: "ok", text: notices.length > 0 ? notices.join(" ") : "Changes saved." });
    await load(showRemoved);
  }

  async function handleResetPassword() {
    if (!resetting) return;
    setFormError(null);
    setBusy(true);

    const { ok, payload } = await send(`${endpoint}/${resetting.id}/password`, {
      method: "POST",
      body: JSON.stringify({
        passwordMode: resetMode,
        password: resetMode === "manual" ? resetPassword : undefined,
        confirmPassword: resetMode === "manual" ? resetConfirm : undefined,
      }),
    });

    setBusy(false);
    if (!ok) {
      setFormError(String(payload.message || "The password could not be reset."));
      return;
    }

    const email = resetting.email;
    setResetting(null);
    setResetPassword("");
    setResetConfirm("");
    if (typeof payload.temporaryPassword === "string") {
      setTempPassword({ email, password: payload.temporaryPassword });
    } else {
      setBanner({ tone: "ok", text: `Password updated for ${email}.` });
    }
    await load(showRemoved);
  }

  async function handleStatus(user: CompanyUser, active: boolean) {
    setBusy(true);
    const { ok, payload } = await send(`${endpoint}/${user.id}/status`, {
      method: "POST",
      body: JSON.stringify({ active }),
    });
    setBusy(false);
    setBanner(
      ok
        ? { tone: "ok", text: `${user.email} was ${active ? "reactivated" : "deactivated"}.` }
        : { tone: "error", text: String(payload.message || "The status could not be changed.") }
    );
    if (ok) await load(showRemoved);
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    const { ok, payload } = await send(`${endpoint}/${deleting.id}`, { method: "DELETE" });
    setBusy(false);
    const notices = Array.isArray(payload.notices) ? (payload.notices as string[]) : [];
    setBanner(
      ok
        ? {
            tone: "ok",
            text:
              notices.length > 0
                ? notices.join(" ")
                : `${deleting.email} no longer has access to this company.`,
          }
        : { tone: "error", text: String(payload.message || "The user could not be removed.") }
    );
    setDeleting(null);
    if (ok) await load(showRemoved);
  }

  async function handleRestore(user: CompanyUser) {
    setBusy(true);
    const { ok, payload } = await send(`${endpoint}/${user.id}?restore=1`, { method: "DELETE" });
    setBusy(false);
    setBanner(
      ok
        ? { tone: "ok", text: `${user.email} was restored.` }
        : { tone: "error", text: String(payload.message || "The user could not be restored.") }
    );
    if (ok) await load(showRemoved);
  }

  async function handleResendInvite(user: CompanyUser) {
    setBusy(true);
    const { ok, payload } = await send(`${endpoint}/${user.id}/invite`, { method: "POST" });
    setBusy(false);
    setBanner(
      ok
        ? { tone: "ok", text: `Invitation sent to ${user.email}.` }
        : { tone: "error", text: String(payload.message || "The invitation could not be sent.") }
    );
  }

  if (loadError) {
    return (
      <Panel className="text-sm font-bold text-rose-700">
        Could not load Users &amp; Access: {loadError}
      </Panel>
    );
  }

  if (!directory) {
    return (
      <Panel className="flex items-center gap-3 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
      </Panel>
    );
  }

  const seatLabel =
    directory.company.userLimit === null
      ? `${directory.activeUserCount} active`
      : `${directory.activeUserCount} / ${directory.company.userLimit} active`;

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">
              {directory.company.name}
            </div>
            <h2 className="mt-2 text-2xl font-black text-[#06101f]">{heading}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {subheading ||
                "Create and manage the people who can sign in to this workspace, the role they hold, and the modules they can reach."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 px-4 py-3 text-right">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                Users
              </div>
              <div className="text-lg font-black text-slate-900">{seatLabel}</div>
            </div>
            {canManage ? (
              <button
                type="button"
                className={primaryButton}
                onClick={() => {
                  setForm(emptyForm(roleOptions[roleOptions.length - 1]?.value || "employee"));
                  setFormError(null);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add User
              </button>
            ) : null}
          </div>
        </div>

        {!canManage ? (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            You can view the users in this company. Only an Owner or Admin can create, edit or
            remove them.
          </p>
        ) : null}

        {directory.seatLimitReached ? (
          <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            This company has reached its licensed user limit. Deactivate a user or request a licence
            increase before adding another.
          </p>
        ) : null}
      </Panel>

      {tempPassword ? (
        <TemporaryPasswordNotice
          email={tempPassword.email}
          password={tempPassword.password}
          onDismiss={() => setTempPassword(null)}
        />
      ) : null}

      {banner ? (
        <div
          className={`rounded-[24px] p-4 text-sm font-bold ${
            banner.tone === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-rose-50 text-rose-700"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={`${inputClass} pl-11`}
              placeholder="Search name, email or role"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
            <input
              type="checkbox"
              checked={showRemoved}
              onChange={(event) => setShowRemoved(event.target.checked)}
            />
            Show removed users
          </label>
        </div>

        <div className="mt-5 overflow-x-auto rounded-[22px] border border-slate-200">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                    No users match this view.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{user.fullName}</div>
                      {user.isSelf ? (
                        <div className="text-[11px] font-black uppercase tracking-wide text-cyan-700">
                          You
                        </div>
                      ) : null}
                      {user.mustChangePassword ? (
                        <div className="text-[11px] font-bold text-amber-700">
                          Must change password
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{user.email}</td>
                    <td className="px-4 py-3 text-slate-600">{user.mobile || "—"}</td>
                    <td className="px-4 py-3 font-bold text-slate-700">{user.roleLabel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide ${STATUS_TONE[user.status]}`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(user.lastLoginAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{user.accessSummary}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {user.status === "deleted" ? (
                          canManage ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={ghostButton}
                              onClick={() => void handleRestore(user)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Restore
                            </button>
                          ) : null
                        ) : (
                          <>
                            {user.canEdit ? (
                              <button
                                type="button"
                                className={ghostButton}
                                onClick={() => {
                                  setForm(formFromUser(user));
                                  setFormError(null);
                                  setEditing(user);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </button>
                            ) : null}
                            {user.canResetPassword ? (
                              <button
                                type="button"
                                className={ghostButton}
                                onClick={() => {
                                  setResetMode("generate");
                                  setResetPassword("");
                                  setResetConfirm("");
                                  setFormError(null);
                                  setResetting(user);
                                }}
                              >
                                <KeyRound className="h-3.5 w-3.5" /> Reset Password
                              </button>
                            ) : null}
                            {user.canEdit ? (
                              <button
                                type="button"
                                disabled={busy}
                                className={ghostButton}
                                onClick={() => void handleResendInvite(user)}
                              >
                                <Mail className="h-3.5 w-3.5" /> Resend Invite
                              </button>
                            ) : null}
                            {user.canChangeStatus ? (
                              <button
                                type="button"
                                disabled={busy}
                                className={ghostButton}
                                onClick={() => void handleStatus(user, user.status !== "active")}
                              >
                                {user.status === "active" ? (
                                  <>
                                    <UserX className="h-3.5 w-3.5" /> Deactivate
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="h-3.5 w-3.5" /> Reactivate
                                  </>
                                )}
                              </button>
                            ) : null}
                            {user.canDelete ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-full border border-rose-200 px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-50"
                                onClick={() => setDeleting(user)}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {createOpen ? (
        <Modal title="Add User" onClose={() => setCreateOpen(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>First Name *</span>
              <input
                className={inputClass}
                value={form.firstName}
                onChange={(event) => updateForm("firstName", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Surname *</span>
              <input
                className={inputClass}
                value={form.lastName}
                onChange={(event) => updateForm("lastName", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Email (used to sign in) *</span>
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(event) => updateForm("email", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Mobile</span>
              <input
                className={inputClass}
                value={form.mobile}
                onChange={(event) => updateForm("mobile", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Role *</span>
              <select
                className={inputClass}
                value={form.role}
                onChange={(event) => updateForm("role", event.target.value)}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">
                {roleOptions.find((option) => option.value === form.role)?.description}
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Status</span>
              <select
                className={inputClass}
                value={form.active ? "active" : "inactive"}
                onChange={(event) => updateForm("active", event.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <div className="mt-6">
            <div className={labelClass}>Password</div>
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
                  onClick={() => updateForm("passwordMode", mode)}
                  className={`rounded-full px-4 py-2 text-xs font-black ${
                    form.passwordMode === mode
                      ? "bg-[#06101f] text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {form.passwordMode === "manual" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Password *</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.password}
                    onChange={(event) => updateForm("password", event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className={labelClass}>Confirm Password *</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.confirmPassword}
                    onChange={(event) => updateForm("confirmPassword", event.target.value)}
                  />
                </label>
                <p className="text-xs text-slate-500 md:col-span-2">{PASSWORD_POLICY_DESCRIPTION}</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                {form.passwordMode === "generate"
                  ? "A strong password is generated on the server and shown to you once. It is set directly on the sign-in account and never stored."
                  : "The user receives an invitation email and chooses their own password."}
              </p>
            )}
          </div>

          <div className="mt-6">
            <div className={labelClass}>Module Access</div>
            <div className="mt-3">
              <ModuleAccessEditor
                availableModules={availableModules}
                mode={form.moduleMode}
                setMode={(mode) => updateForm("moduleMode", mode)}
                selected={form.modules}
                toggleModule={toggleFormModule}
                permissions={form.permissions}
                togglePermission={toggleFormPermission}
              />
            </div>
          </div>

          {formError ? (
            <p className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">
              {formError}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className={ghostButton} onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => void handleCreate()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Create User
            </button>
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={`Edit ${editing.fullName}`} onClose={() => setEditing(null)}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>First Name *</span>
              <input
                className={inputClass}
                value={form.firstName}
                onChange={(event) => updateForm("firstName", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Surname *</span>
              <input
                className={inputClass}
                value={form.lastName}
                onChange={(event) => updateForm("lastName", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Email *</span>
              <input
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(event) => updateForm("email", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Mobile</span>
              <input
                className={inputClass}
                value={form.mobile}
                onChange={(event) => updateForm("mobile", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Role</span>
              <select
                className={inputClass}
                value={form.role}
                disabled={editing.isSelf}
                onChange={(event) => updateForm("role", event.target.value)}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {editing.isSelf ? (
                <span className="text-xs text-slate-500">You cannot change your own role.</span>
              ) : null}
            </label>
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Status</span>
              <select
                className={inputClass}
                value={form.active ? "active" : "inactive"}
                disabled={editing.isSelf}
                onChange={(event) => updateForm("active", event.target.value === "active")}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <div className="mt-6">
            <div className={labelClass}>Module Access</div>
            <div className="mt-3">
              <ModuleAccessEditor
                availableModules={availableModules}
                mode={form.moduleMode}
                setMode={(mode) => updateForm("moduleMode", mode)}
                selected={form.modules}
                toggleModule={toggleFormModule}
                permissions={form.permissions}
                togglePermission={toggleFormPermission}
              />
            </div>
          </div>

          {formError ? (
            <p className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">
              {formError}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className={ghostButton} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => void handleUpdate()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </Modal>
      ) : null}

      {resetting ? (
        <Modal title={`Reset password — ${resetting.email}`} onClose={() => setResetting(null)}>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["generate", "Generate temporary password"],
                ["manual", "Set password manually"],
              ] as ["generate" | "manual", string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setResetMode(mode)}
                className={`rounded-full px-4 py-2 text-xs font-black ${
                  resetMode === mode ? "bg-[#06101f] text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {resetMode === "manual" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className={labelClass}>New Password *</span>
                <input
                  type="password"
                  className={inputClass}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className={labelClass}>Confirm Password *</span>
                <input
                  type="password"
                  className={inputClass}
                  value={resetConfirm}
                  onChange={(event) => setResetConfirm(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500 md:col-span-2">{PASSWORD_POLICY_DESCRIPTION}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              A strong password is generated on the server, applied to the sign-in account and shown
              to you once.
            </p>
          )}

          {formError ? (
            <p className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">
              {formError}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className={ghostButton} onClick={() => setResetting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={busy}
              onClick={() => void handleResetPassword()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Reset Password
            </button>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal title="Delete user" onClose={() => setDeleting(null)}>
          <p className="text-sm leading-6 text-slate-700">
            <span className="font-bold">{deleting.fullName}</span> ({deleting.email}) will lose all
            access to this company immediately.
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Their company membership is marked as removed, not erased.</li>
            <li>
              Audit history, and any records they created, are preserved and remain attributed to
              them.
            </li>
            <li>
              Their sign-in account is disabled only if this is the last VYRON CORE workspace they
              belong to.
            </li>
            <li>A removed user can be restored from &quot;Show removed users&quot;.</li>
          </ul>

          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className={ghostButton} onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-3 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60"
              onClick={() => void handleDelete()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete User
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
