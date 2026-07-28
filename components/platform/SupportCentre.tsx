"use client";

import React, { useEffect, useState } from "react";
import { Search, UserCog, KeyRound, Unlock, Mail, ShieldCheck, Stethoscope } from "lucide-react";
import { platformFetch } from "@/lib/platform/platform-client";
import PlatformPanel from "./PlatformPanel";

type CustomerRow = { id: string; name: string; trading_name: string | null; customer_status: string | null };
type NoteRow = { id: string; operator_email: string; note: string; created_at: string };
type DiagnosticsData = {
  company: { name: string; customer_status: string | null };
  recentSessions: { user_email: string; last_seen_at: string | null; revoked_at: string | null }[];
  recentActivity: { user_email: string; action: string; entity_type: string; created_at: string }[];
  errorTracking: { instrumented: boolean; note: string };
};

export default function SupportCentre() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [newNote, setNewNote] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonationToken, setImpersonationToken] = useState<string | null>(null);
  const [prevSearch, setPrevSearch] = useState(search);

  if (prevSearch !== search) {
    setPrevSearch(search);
    if (!search.trim()) setResults([]);
  }

  useEffect(() => {
    if (!search.trim()) {
      return;
    }
    const timeout = setTimeout(async () => {
      const result = await platformFetch<{ customers: CustomerRow[] }>(
        `/api/platform/customers?search=${encodeURIComponent(search.trim())}`
      );
      if (result.ok) setResults(result.data.customers);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  async function selectCustomer(customer: CustomerRow) {
    setSelected(customer);
    setMessage(null);
    setError(null);
    setImpersonationToken(null);
    const notesResult = await platformFetch<{ notes: NoteRow[] }>(
      `/api/platform/support/notes?companyId=${customer.id}`
    );
    if (notesResult.ok) setNotes(notesResult.data.notes);
    const diagResult = await platformFetch<DiagnosticsData>(
      `/api/platform/support/diagnostics?companyId=${customer.id}`
    );
    if (diagResult.ok) setDiagnostics(diagResult.data);
  }

  async function runAction(path: string, body: Record<string, unknown>, successMessage: string) {
    if (!selected) return;
    setError(null);
    setMessage(null);
    const result = await platformFetch(path, { method: "POST", body: JSON.stringify({ companyId: selected.id, ...body }) });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(successMessage);
    return result.data as Record<string, unknown>;
  }

  async function handleAddNote() {
    if (!newNote.trim()) return;
    await runAction("/api/platform/support/notes", { note: newNote.trim() }, "Note added.");
    setNewNote("");
    if (selected) selectCustomer(selected);
  }

  async function handleImpersonate() {
    const data = await runAction("/api/platform/support/impersonate", {}, "Impersonation session started (fully audited).");
    if (data?.sessionToken) setImpersonationToken(String(data.sessionToken));
  }

  async function handleEndImpersonation() {
    if (!impersonationToken) return;
    const result = await platformFetch(`/api/platform/support/impersonate?sessionToken=${impersonationToken}`, {
      method: "DELETE",
    });
    if (result.ok) {
      setMessage("Impersonation session ended.");
      setImpersonationToken(null);
    } else {
      setError(result.message);
    }
  }

  const inputClass = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:border-cyan-500";

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <PlatformPanel>
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {results.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => selectCustomer(customer)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-bold ${
                  selected?.id === customer.id ? "bg-cyan-50 text-cyan-800" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {customer.name}
                <span className="ml-2 text-xs font-normal text-slate-400">{customer.customer_status}</span>
              </button>
            </li>
          ))}
        </ul>
      </PlatformPanel>

      <div className="flex flex-col gap-6">
        {!selected ? (
          <PlatformPanel className="text-center text-slate-500">Search for a customer to begin.</PlatformPanel>
        ) : (
          <>
            <PlatformPanel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black text-[#06101f]">{selected.name}</h2>
                {impersonationToken ? (
                  <button
                    type="button"
                    onClick={handleEndImpersonation}
                    className="rounded-full bg-rose-600 px-4 py-2 text-xs font-black text-white"
                  >
                    End Impersonation Session
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleImpersonate}
                    className="inline-flex items-center gap-2 rounded-full bg-[#06101f] px-4 py-2 text-xs font-black text-white"
                  >
                    <UserCog className="h-4 w-4" /> Login As Customer
                  </button>
                )}
              </div>
              {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
              {message ? <p className="mt-3 text-sm font-bold text-emerald-700">{message}</p> : null}
            </PlatformPanel>

            <PlatformPanel>
              <h3 className="text-lg font-black text-[#06101f]">User Account Actions</h3>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  className={inputClass}
                  placeholder="User email"
                  value={targetEmail}
                  onChange={(e) => setTargetEmail(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runAction("/api/platform/support/unlock-account", { userEmail: targetEmail }, "Account unlocked.")}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                  >
                    <Unlock className="h-4 w-4" /> Unlock Account
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction("/api/platform/support/resend-invite", { userEmail: targetEmail }, "Invite resent.")}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                  >
                    <Mail className="h-4 w-4" /> Resend Invitation
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const data = await runAction(
                        "/api/platform/support/temp-admin",
                        { userEmail: targetEmail },
                        "Temporary administrator created."
                      );
                      if (data?.temporaryPassword) {
                        window.alert(`Temporary password for ${targetEmail}: ${data.temporaryPassword}`);
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                  >
                    <ShieldCheck className="h-4 w-4" /> Generate Temp Administrator
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={inputClass}
                    type="password"
                    placeholder="New password (min 8 chars)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => runAction("/api/platform/support/reset-password", { userEmail: targetEmail, password: newPassword }, "Password reset.")}
                    className="inline-flex items-center gap-2 rounded-full bg-[#06101f] px-4 py-2 text-xs font-black text-white"
                  >
                    <KeyRound className="h-4 w-4" /> Reset Password
                  </button>
                </div>
              </div>
            </PlatformPanel>

            <PlatformPanel>
              <h3 className="text-lg font-black text-[#06101f]">Support Notes</h3>
              <div className="mt-3 flex gap-2">
                <input className={inputClass} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note…" />
                <button type="button" onClick={handleAddNote} className="rounded-full bg-[#06101f] px-4 py-2 text-xs font-black text-white">
                  Add
                </button>
              </div>
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                {notes.length === 0 ? (
                  <li className="text-slate-500">No support notes yet.</li>
                ) : (
                  notes.map((note) => (
                    <li key={note.id} className="border-b border-slate-100 pb-2">
                      <div className="font-bold text-slate-800">{note.note}</div>
                      <div className="text-xs text-slate-400">{note.operator_email} · {note.created_at.slice(0, 19).replace("T", " ")}</div>
                    </li>
                  ))
                )}
              </ul>
            </PlatformPanel>

            <PlatformPanel>
              <h3 className="flex items-center gap-2 text-lg font-black text-[#06101f]">
                <Stethoscope className="h-5 w-5" /> Diagnostics
              </h3>
              {!diagnostics ? (
                <p className="mt-3 text-sm text-slate-500">Loading…</p>
              ) : (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-black uppercase text-slate-500">Recent Sessions</div>
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {diagnostics.recentSessions.map((session, index) => (
                        <li key={index} className="text-slate-700">
                          {session.user_email} — {session.revoked_at ? "revoked" : "active"} ({session.last_seen_at?.slice(0, 16) || "—"})
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-black uppercase text-slate-500">Recent Activity</div>
                    <ul className="mt-2 flex flex-col gap-1 text-sm">
                      {diagnostics.recentActivity.map((entry, index) => (
                        <li key={index} className="text-slate-700">
                          {entry.user_email} {entry.action} · {entry.entity_type}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="md:col-span-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                    Error / API / AI failure telemetry: {diagnostics.errorTracking.note}
                  </div>
                </div>
              )}
            </PlatformPanel>
          </>
        )}
      </div>
    </div>
  );
}
