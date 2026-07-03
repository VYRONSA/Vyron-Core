"use client";

import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  FileText,
  MapPin,
  MessageSquarePlus,
  Package,
  RefreshCcw,
  Star,
  WalletCards,
} from "lucide-react";
import {
  formatCurrency,
  formatPortalTimestamp,
  loadClientPortalHub,
  submitClientRating,
  submitClientRequest,
  visitTimelineSummary,
  type ClientPortalHub as HubData,
  type ClientPortalView,
} from "@/lib/client-portal-platform";
import { supabase } from "@/lib/supabase";

type Props = {
  companyId: string;
  clientId: string;
  portalUserId?: string | null;
  contactName?: string;
  employees?: { id: string; first_name: string; last_name: string }[];
};

const VIEWS: { id: ClientPortalView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "hub", label: "Overview", icon: Building2 },
  { id: "jobs", label: "My Jobs", icon: Briefcase },
  { id: "assets", label: "My Assets", icon: Package },
  { id: "sites", label: "My Sites", icon: MapPin },
  { id: "reports", label: "My Reports", icon: FileText },
  { id: "documents", label: "My Documents", icon: FileText },
  { id: "invoices", label: "My Invoices", icon: WalletCards },
  { id: "requests", label: "Requests", icon: MessageSquarePlus },
  { id: "satisfaction", label: "Satisfaction", icon: Star },
];

export default function ClientPortalHub({
  companyId,
  clientId,
  portalUserId,
  contactName,
  employees = [],
}: Props) {
  const [view, setView] = useState<ClientPortalView>("hub");
  const [hub, setHub] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [requestSubject, setRequestSubject] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState("");
  const [ratingJobId, setRatingJobId] = useState("");

  async function load() {
    if (!companyId || !clientId) return;
    setLoading(true);
    const portalUser = portalUserId
      ? {
          id: portalUserId,
          companyId,
          clientId,
          email: "",
          contactName: contactName || "Client",
          phone: null,
          role: "viewer",
          status: "active",
        }
      : null;
    const data = await loadClientPortalHub(supabase, companyId, clientId, portalUser, employees);
    setHub(data);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId, clientId, portalUserId]);

  async function handleSubmitRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!requestSubject.trim()) {
      setError("Subject is required.");
      return;
    }
    const result = await submitClientRequest(supabase, {
      companyId,
      clientId,
      portalUserId,
      subject: requestSubject,
      description: requestDescription,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage("Request submitted. Our team will respond shortly.");
    setRequestSubject("");
    setRequestDescription("");
    await load();
  }

  async function handleSubmitRating(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const result = await submitClientRating(supabase, {
      companyId,
      clientId,
      portalUserId,
      jobId: ratingJobId || null,
      rating,
      feedback,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessage("Thank you for your feedback.");
    setFeedback("");
    setRatingJobId("");
    await load();
  }

  const greeting = contactName || hub?.clientName || "Client";

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.35em] text-violet-700">
              Client Portal
            </div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">
              Welcome, {greeting}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Track jobs, visits, documents, and service quality in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {!hub?.tablesAvailable && !loading && (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Run migration <code className="font-mono">sql/034-client-portal-platform.sql</code> to
            enable the client portal.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider ${
              view === item.id
                ? "bg-[#06101f] text-violet-300"
                : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {(error || message) && (
        <p
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            error
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || message}
        </p>
      )}

      {view === "hub" && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Active Jobs", value: hub?.jobs.filter((j) => j.status !== "Completed").length ?? 0 },
            { label: "Sites", value: hub?.sites.length ?? 0 },
            { label: "Assets", value: hub?.assets.length ?? 0 },
            {
              label: "Satisfaction",
              value: hub?.satisfaction.averageRating
                ? `${hub.satisfaction.averageRating}/5`
                : "—",
            },
            {
              label: "Revenue (period)",
              value: hub ? formatCurrency(hub.reportSummary.revenue) : "—",
            },
            { label: "Open Requests", value: hub?.requests.filter((r) => r.status === "open").length ?? 0 },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[1.5rem] border border-violet-100/80 bg-violet-50/40 p-5 shadow-sm"
            >
              <div className="text-3xl font-black text-slate-950">{loading ? "…" : card.value}</div>
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">
                {card.label}
              </div>
            </div>
          ))}
        </section>
      )}

      {view === "jobs" && (
        <section className="space-y-4">
          {(hub?.jobs || []).length === 0 ? (
            <p className="text-sm text-slate-500">No jobs linked to your account yet.</p>
          ) : (
            (hub?.jobs || []).map((job) => (
              <div
                key={job.id}
                className="rounded-[1.5rem] border border-white/80 bg-white/95 p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-slate-500">{job.jobRef}</div>
                    <h3 className="text-lg font-black text-slate-950">{job.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{job.siteLabel}</p>
                  </div>
                  <span className="rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-violet-900">
                    {job.status}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  Technician: {job.technicianName || "To be assigned"} · Scheduled{" "}
                  {formatPortalTimestamp(job.scheduledStart)}
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {visitTimelineSummary(job.events)}
                </p>
                {job.events.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-slate-600">
                    {job.events.map((event, idx) => (
                      <li key={`${job.id}-ev-${idx}`}>
                        {event.eventType} — {formatPortalTimestamp(event.recordedAt)}
                      </li>
                    ))}
                  </ul>
                )}
                {job.photos.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {job.photos.map((photo, idx) => (
                      <a
                        key={`${job.id}-ph-${idx}`}
                        href={photo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-violet-800"
                      >
                        Photo · {photo.evidenceType}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {view === "assets" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Asset</th>
                <th className="px-2 py-2">Number</th>
                <th className="px-2 py-2">Site</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(hub?.assets || []).map((asset) => (
                <tr key={asset.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-bold">{asset.assetName}</td>
                  <td className="px-2 py-2">{asset.assetNumber || "—"}</td>
                  <td className="px-2 py-2">{asset.siteLabel || "—"}</td>
                  <td className="px-2 py-2">{asset.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view === "sites" && (
        <section className="grid gap-4 md:grid-cols-2">
          {(hub?.sites || []).map((site) => (
            <div
              key={site.siteKey}
              className="rounded-[1.5rem] border border-cyan-100 bg-cyan-50/40 p-5"
            >
              <h3 className="font-black text-slate-950">{site.siteLabel}</h3>
              <p className="mt-2 text-sm text-slate-600">
                {site.jobsCount} jobs · {site.activeJobs} active
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Last activity: {formatPortalTimestamp(site.lastVisit)}
              </p>
            </div>
          ))}
        </section>
      )}

      {view === "reports" && hub && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Service report summary</h3>
          <p className="mt-2 text-sm text-slate-600">Period: {hub.reportSummary.periodLabel}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-violet-50 p-4">
              <div className="text-2xl font-black">{hub.reportSummary.jobsCompleted}</div>
              <div className="text-xs font-bold uppercase text-slate-500">Jobs completed</div>
            </div>
            <div className="rounded-2xl bg-violet-50 p-4">
              <div className="text-2xl font-black">{formatCurrency(hub.reportSummary.revenue)}</div>
              <div className="text-xs font-bold uppercase text-slate-500">Service value</div>
            </div>
            <div className="rounded-2xl bg-violet-50 p-4">
              <div className="text-2xl font-black">{hub.reportSummary.marginPct}%</div>
              <div className="text-xs font-bold uppercase text-slate-500">Service efficiency</div>
            </div>
          </div>
        </section>
      )}

      {view === "documents" && (
        <section className="space-y-3">
          {(hub?.documents || []).length === 0 ? (
            <p className="text-sm text-slate-500">No documents shared yet.</p>
          ) : (
            (hub?.documents || []).map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <div className="font-bold text-slate-950">{doc.title}</div>
                  <div className="text-xs text-slate-500">
                    {doc.documentType} · {formatPortalTimestamp(doc.uploadedAt)}
                  </div>
                </div>
                {doc.fileUrl && (
                  <a
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-bold text-violet-800"
                  >
                    Open
                  </a>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {view === "invoices" && (
        <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs font-black uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Job</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(hub?.invoices || []).map((inv) => (
                <tr key={inv.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">
                    <div className="font-mono text-xs">{inv.jobRef}</div>
                    <div className="font-semibold">{inv.jobTitle}</div>
                  </td>
                  <td className="px-2 py-2">{inv.invoiceDate}</td>
                  <td className="px-2 py-2 font-bold">{formatCurrency(inv.revenue)}</td>
                  <td className="px-2 py-2">{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {view === "requests" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-violet-100 bg-violet-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Submit a request</h3>
            <form onSubmit={handleSubmitRequest} className="mt-4 grid gap-3">
              <input
                value={requestSubject}
                onChange={(e) => setRequestSubject(e.target.value)}
                placeholder="Subject"
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <textarea
                value={requestDescription}
                onChange={(e) => setRequestDescription(e.target.value)}
                placeholder="Describe your request…"
                rows={4}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <button
                type="submit"
                className="rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-violet-300"
              >
                Submit request
              </button>
            </form>
          </section>
          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Your requests</h3>
            <div className="mt-4 space-y-3">
              {(hub?.requests || []).map((req) => (
                <div key={req.id} className="rounded-2xl border border-slate-100 px-4 py-3 text-sm">
                  <div className="font-bold">{req.subject}</div>
                  <div className="text-xs text-slate-500">
                    {req.requestType} · {req.status} · {formatPortalTimestamp(req.submittedAt)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {view === "satisfaction" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-amber-100 bg-amber-50/40 p-6">
            <h3 className="text-lg font-black text-slate-950">Client satisfaction</h3>
            <div className="mt-4 text-4xl font-black text-slate-950">
              {hub?.satisfaction.averageRating ? `${hub.satisfaction.averageRating}/5` : "—"}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              {hub?.satisfaction.npsLabel} · {hub?.satisfaction.totalRatings} ratings
            </p>
            <form onSubmit={handleSubmitRating} className="mt-6 grid gap-3">
              <label className="text-sm font-bold text-slate-700">
                Rate your experience (1–5)
                <select
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                  className="mt-2 w-full rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} stars
                    </option>
                  ))}
                </select>
              </label>
              <select
                value={ratingJobId}
                onChange={(e) => setRatingJobId(e.target.value)}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              >
                <option value="">General feedback (no job)</option>
                {(hub?.jobs || []).map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.jobRef} — {job.title}
                  </option>
                ))}
              </select>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional comments…"
                rows={3}
                className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-semibold"
              />
              <button
                type="submit"
                className="rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-amber-300"
              >
                Submit rating
              </button>
            </form>
          </section>
          <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">Recent feedback</h3>
            <div className="mt-4 space-y-3">
              {(hub?.satisfaction.recentRatings || []).map((r, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-100 px-4 py-3 text-sm">
                  <div className="font-black text-amber-700">{r.rating}/5</div>
                  {r.jobRef && <div className="text-xs text-slate-500">Job {r.jobRef}</div>}
                  {r.feedback && <p className="mt-1 text-slate-700">{r.feedback}</p>}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
