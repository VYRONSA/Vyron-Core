"use client";

import {
  BarChart3,
  Building2,
  CheckCircle2,
  Crown,
  DollarSign,
  Rocket,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import RevenueImpactSimulator from "@/components/RevenueImpactSimulator";
import SalesPipelineCommandCentre from "@/components/SalesPipelineCommandCentre";
import PricingPackagingConsole from "@/components/PricingPackagingConsole";
import CustomerSuccessHealthScore from "@/components/CustomerSuccessHealthScore";
import ExpansionOpportunityFinder from "@/components/ExpansionOpportunityFinder";
import ClientOnboardingCommandCentre from "@/components/ClientOnboardingCommandCentre";
import SecurityPermissionsMatrix from "@/components/SecurityPermissionsMatrix";
import AuditTrailCommandCentre from "@/components/AuditTrailCommandCentre";

function OwnerMetricCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-[0_32px_90px_rgba(37,99,235,0.18)]">
      <div className="flex items-start justify-between gap-4">
        <div className="rounded-2xl bg-[#06101f] p-3 text-cyan-300">
          {icon}
        </div>

        <span className="rounded-full bg-cyan-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.25em] text-cyan-700">
          Owner
        </span>
      </div>

      <div className="mt-7 text-4xl font-black tracking-tight text-slate-950">
        {value}
      </div>

      <div className="mt-2 text-sm font-black text-slate-700">
        {title}
      </div>

      <div className="mt-3 text-xs leading-5 text-slate-500">
        {subtitle}
      </div>
    </article>
  );
}

function OwnerRoadmapPanel() {
  const roadmap = [
    {
      title: "Client-facing automation",
      status: "In build",
      note: "Automation Centre becomes part of VYRON CORE.",
    },
    {
      title: "Workforce intelligence integration",
      status: "Next",
      note: "Move workforce intelligence into the main client sidebar.",
    },
    {
      title: "Payroll export hardening",
      status: "Critical",
      note: "Sage Pastel, SimplePay and generic payroll CSV refinement.",
    },
    {
      title: "Mobile manager workflows",
      status: "Upcoming",
      note: "Approvals, clock reviews, notifications and HR actions on mobile.",
    },
  ];

  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            Product Roadmap
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Founder Product Roadmap
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            A private owner view of what still needs to be built, hardened, launched and monetised.
          </p>
        </div>

        <div className="rounded-full bg-amber-100 px-4 py-2 text-sm font-black text-amber-700">
          4 priority tracks
        </div>
      </div>

      <div className="mt-8 space-y-4">
        {roadmap.map((item) => (
          <article
            key={item.title}
            className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="font-black text-slate-950">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">{item.note}</p>
              </div>

              <span className="w-fit rounded-full bg-[#06101f] px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
                {item.status}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FounderLaunchChecklist() {
  const checklist = [
    "Finish client-facing payroll blocker workflow",
    "Finish production-ready reports and exports",
    "Build demo company data for sales demos",
    "Create pricing page and proposal template",
    "Prepare first 50 prospect outreach list",
    "Deploy stable demo to Vercel",
    "Connect owner dashboard to real CRM/client data later",
  ];

  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
            Launch Control
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Founder Launch Checklist
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            The practical checklist for turning VYRON CORE from product build into a sellable SaaS.
          </p>
        </div>

        <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-700">
          Launch mode
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {checklist.map((item, index) => (
          <article
            key={item}
            className="flex items-start gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-sm font-black text-cyan-700">
              {index + 1}
            </div>

            <div>
              <div className="font-black text-slate-950">{item}</div>
              <div className="mt-1 text-xs text-slate-500">Owner action item</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function OwnerDashboardPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#07101f] p-5 md:p-8">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-180px] top-[-220px] h-[620px] w-[620px] rounded-full bg-cyan-400/20 blur-[140px]" />
        <div className="absolute right-[-180px] top-[80px] h-[760px] w-[760px] rounded-full bg-blue-500/20 blur-[160px]" />
        <div className="absolute bottom-[-260px] left-[36%] h-[680px] w-[680px] rounded-full bg-sky-300/16 blur-[170px]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,6,23,0.98)_0%,rgba(7,16,31,0.96)_30%,rgba(238,246,255,0.94)_30%,rgba(248,251,255,0.96)_100%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1800px] space-y-8">
        <section className="relative overflow-hidden rounded-[38px] border border-cyan-300/15 bg-gradient-to-br from-[#020617] via-[#07101f] to-[#0b1f3a] p-8 text-white shadow-[0_34px_100px_rgba(2,6,23,0.36),0_0_52px_rgba(34,211,238,0.14)]">
          <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-[80px]" />

          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.45em] text-cyan-300">
                VYRON OWNER HQ
              </div>

              <h1 className="mt-4 max-w-5xl text-5xl font-black tracking-tight md:text-6xl">
                Founder, Growth & Enterprise Control Centre
              </h1>

              <p className="mt-5 max-w-3xl text-sm leading-7 text-slate-300">
                Private owner dashboard for pricing, sales pipeline, client success,
                expansion opportunities, onboarding, security posture, audit controls and product roadmap.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
              <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">
                Target MRR
              </div>
              <div className="mt-3 text-4xl font-black text-white">R500k+</div>
              <div className="mt-2 text-xs text-slate-300">
                Phase 1 founder target
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <OwnerMetricCard
            title="Projected Pipeline"
            value="R160k"
            subtitle="Potential monthly revenue from current sales pipeline"
            icon={<TrendingUp className="h-6 w-6" />}
          />

          <OwnerMetricCard
            title="Target ARPA"
            value="R18k+"
            subtitle="Average revenue per account target"
            icon={<DollarSign className="h-6 w-6" />}
          />

          <OwnerMetricCard
            title="Client Health"
            value="87%"
            subtitle="Portfolio health and retention strength"
            icon={<ShieldCheck className="h-6 w-6" />}
          />

          <OwnerMetricCard
            title="Expansion Pipeline"
            value="R33k"
            subtitle="Potential upsell opportunities per month"
            icon={<Rocket className="h-6 w-6" />}
          />
        </section>

        <FounderLaunchChecklist />
        <OwnerRoadmapPanel />

        <RevenueImpactSimulator />
        <SalesPipelineCommandCentre />
        <PricingPackagingConsole />
        <CustomerSuccessHealthScore />
        <ExpansionOpportunityFinder />

        <ClientOnboardingCommandCentre />
        <SecurityPermissionsMatrix />
        <AuditTrailCommandCentre />

        <section className="grid gap-5 md:grid-cols-3">
          <article className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <Crown className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Owner-only area</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Keep this page hidden from normal client users. It contains your pricing,
              pipeline and company-building controls.
            </p>
          </article>

          <article className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <Building2 className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Client-facing app remains CORE</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Normal clients should remain inside the main VYRON CORE app with workforce,
              payroll, HR, leave, compliance and automation modules.
            </p>
          </article>

          <article className="rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_22px_65px_rgba(15,23,42,0.13)] backdrop-blur-xl">
            <BarChart3 className="h-8 w-8 text-cyan-700" />
            <h3 className="mt-5 text-2xl font-black text-slate-950">Future connection</h3>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Later this can connect to real Supabase owner tables for prospects,
              deals, clients, MRR, churn and product roadmap tracking.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
