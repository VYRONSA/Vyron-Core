"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  ShieldCheck,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

const navGroups = [
  {
    label: "Command",
    items: [
      { label: "Command Centre", icon: LayoutDashboard, active: true, badge: "" },
      { label: "Manager Action Centre", icon: Bell, active: false, badge: "14" },
      { label: "Smart Detection", icon: Zap, active: false, badge: "" },
      { label: "Live Activity", icon: Clock3, active: false, badge: "" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Employees", icon: Users, active: false, badge: "" },
      { label: "Employee HR File", icon: FileText, active: false, badge: "" },
      { label: "Employee Notifications", icon: Bell, active: false, badge: "" },
    ],
  },
  {
    label: "Time & Shifts",
    items: [
      { label: "Clocking", icon: Clock3, active: false, badge: "" },
      { label: "Roster Intelligence", icon: CalendarDays, active: false, badge: "" },
      { label: "Payroll Clock Engine", icon: WalletCards, active: false, badge: "" },
      { label: "Exceptions", icon: AlertTriangle, active: false, badge: "" },
    ],
  },
  {
    label: "HR & Compliance",
    items: [
      { label: "HR Cases", icon: ShieldCheck, active: false, badge: "14" },
      { label: "HR Warnings", icon: FileText, active: false, badge: "" },
      { label: "HR Contract Centre", icon: FileText, active: false, badge: "" },
      { label: "Employee Document Vault", icon: FileText, active: false, badge: "" },
    ],
  },
];

function LogoMark() {
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-[24px] bg-gradient-to-br from-blue-400 via-cyan-300 to-sky-500 text-xl font-black text-[#04101f] shadow-[0_0_35px_rgba(34,211,238,0.45)]">
        V
        <div className="absolute inset-0 rounded-[24px] border border-white/35" />
      </div>

      <div>
        <div className="text-2xl font-black tracking-[0.34em] text-white">VYRON</div>
        <div className="mt-[-2px] text-xs font-bold tracking-[0.55em] text-cyan-300">CORE</div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  note,
  icon,
  dark = false,
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-[2rem] p-6 shadow-[0_18px_55px_rgba(15,23,42,0.14)] transition hover:-translate-y-1 ${
        dark
          ? "bg-[#06101f] text-white"
          : "border border-white/80 bg-white/95 text-[#06101f] backdrop-blur-xl"
      }`}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-300/20 blur-[55px]" />

      <div className="relative z-10 flex items-start justify-between">
        <div className={dark ? "rounded-2xl bg-cyan-400/15 p-3 text-cyan-300" : "rounded-2xl bg-cyan-50 p-3 text-cyan-700"}>
          {icon}
        </div>
        <ChevronRight className={dark ? "text-cyan-300/70" : "text-cyan-600"} size={18} />
      </div>

      <div className={`relative z-10 mt-6 text-sm font-bold ${dark ? "text-slate-300" : "text-slate-500"}`}>{title}</div>
      <div className="relative z-10 mt-2 text-4xl font-black">{value}</div>
      <div className={`relative z-10 mt-2 text-sm font-black ${dark ? "text-cyan-300" : "text-cyan-700"}`}>{note}</div>
    </div>
  );
}

function ModuleCard({
  title,
  text,
  icon,
  dark = false,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`group cursor-pointer rounded-[2rem] p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(37,99,235,0.22)] ${
        dark ? "bg-[#06101f] text-white" : "border border-white/80 bg-white/95 text-[#06101f] backdrop-blur-xl"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={dark ? "rounded-2xl bg-cyan-400/15 p-3 text-cyan-300" : "rounded-2xl bg-cyan-50 p-3 text-cyan-700"}>
          {icon}
        </div>
        <ChevronRight className={dark ? "text-cyan-300" : "text-cyan-600"} size={20} />
      </div>

      <h3 className="mt-5 text-xl font-black">{title}</h3>
      <p className={`mt-3 text-sm leading-7 ${dark ? "text-slate-300" : "text-slate-500"}`}>{text}</p>
    </div>
  );
}

export default function VyronCoreDesignPreviewPage() {
  const router = useRouter();
  const [openGroup, setOpenGroup] = useState("Command");

  return (
    <main className="min-h-screen overflow-hidden bg-[#04100d] text-[#06101f]">
      <div className="flex">
        <aside className="hidden min-h-screen w-[310px] shrink-0 flex-col bg-[#050b16] px-5 py-6 text-white shadow-[24px_0_80px_rgba(0,0,0,0.35)] lg:flex">
          <LogoMark />

          <nav className="mt-10 flex-1 space-y-4 overflow-y-auto pr-1">
            {navGroups.map((group) => {
              const isOpen = openGroup === group.label;
              const badgeTotal = group.items.reduce((sum, item) => sum + Number(item.badge || 0), 0);

              return (
                <section key={group.label} className="rounded-[24px] border border-white/10 bg-white/[0.045]">
                  <button
                    onClick={() => setOpenGroup(isOpen ? "" : group.label)}
                    className={`flex w-full items-center justify-between rounded-[24px] px-4 py-4 text-left text-xs font-black uppercase tracking-[0.24em] transition ${
                      isOpen ? "bg-cyan-400/10 text-cyan-300" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>{group.label}</span>
                    <span className="flex items-center gap-2">
                      {badgeTotal > 0 && (
                        <span className="rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black leading-none text-white">
                          {badgeTotal}
                        </span>
                      )}
                      <Plus className={`h-4 w-4 transition ${isOpen ? "rotate-45 text-cyan-300" : ""}`} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="space-y-1 px-2 pb-3">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-black transition ${
                              item.active
                                ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-[0_15px_35px_rgba(34,211,238,0.28)]"
                                : "text-slate-300 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="flex-1">{item.label}</span>
                            {item.badge && (
                              <span className={item.active ? "rounded-full bg-white px-2 py-1 text-[11px] font-black text-cyan-700" : "rounded-full bg-rose-500 px-2 py-1 text-[11px] font-black text-white"}>
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </nav>

          <div className="mt-6 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/30 text-sm font-black">
            N
          </div>
        </aside>

        <section className="relative min-h-screen flex-1">
          <div className="pointer-events-none fixed inset-0 z-0">
            <div className="absolute left-[240px] top-[-200px] h-[680px] w-[680px] rounded-full bg-cyan-400/18 blur-[140px]" />
            <div className="absolute right-[-180px] top-[140px] h-[740px] w-[740px] rounded-full bg-blue-500/20 blur-[160px]" />
            <div className="absolute bottom-[-220px] left-[36%] h-[620px] w-[620px] rounded-full bg-sky-300/18 blur-[160px]" />
            <div className="absolute inset-y-0 left-[310px] right-0 bg-[linear-gradient(135deg,rgba(8,47,73,0.96)_0%,rgba(14,116,144,0.9)_34%,rgba(238,246,255,0.93)_34%,rgba(238,246,255,0.93)_100%)]" />
          </div>

          <div className="relative z-10 px-6 py-7">
            <button
              onClick={() => router.back()}
              className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/20"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <header className="rounded-[2.2rem] border border-white/70 bg-white/92 p-7 shadow-[0_22px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
              <div className="inline-flex rounded-full bg-cyan-100 px-4 py-2 text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
                VYRON CORE COMMAND CENTRE
              </div>

              <h1 className="mt-5 text-5xl font-black tracking-tight text-[#06101f]">
                Workforce Command Centre
              </h1>

              <p className="mt-4 max-w-5xl text-base leading-8 text-slate-600">
                Enterprise workforce control, clocking, HR risk, roster movement and payroll readiness in one connected system.
              </p>
            </header>

            <section className="mt-6 rounded-[2.2rem] bg-[#06101f] p-7 text-white shadow-[0_22px_70px_rgba(6,16,31,0.35)]">
              <div className="grid gap-7 xl:grid-cols-[1.25fr_0.75fr]">
                <div>
                  <div className="inline-flex rounded-full bg-cyan-400/15 px-4 py-2 text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
                    LIVE OPERATIONS CONTROL
                  </div>

                  <h2 className="mt-5 max-w-4xl text-4xl font-black tracking-tight md:text-5xl">
                    See payroll blockers before they cost money.
                  </h2>

                  <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300">
                    Same VYRON COST layout DNA, rebuilt for CORE with blue/cyan accents and workforce intelligence.
                  </p>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button className="rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-[#06101f]">
                      Review Exceptions
                    </button>
                    <button className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                      Open Rosters
                    </button>
                    <button className="rounded-full border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300">
                      Payroll Prep
                    </button>
                  </div>
                </div>

                <div className="rounded-[2rem] border border-cyan-400/15 bg-white/5 p-6">
                  <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">
                    ESTIMATED MONTHLY LOSS
                  </div>
                  <div className="mt-4 text-5xl font-black">R35 000</div>
                  <div className="mt-3 text-sm leading-7 text-slate-300">
                    Late clock-ins, overtime, missing records and HR risk before payroll starts.
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Total Hours Today" value="210" note="Live from workforce" icon={<Clock3 size={22} />} />
              <StatCard title="Overtime Hours" value="0" note="Watch overtime" icon={<Clock3 size={22} />} />
              <StatCard title="Open Exceptions" value="0" note="Clean" icon={<AlertTriangle size={22} />} />
              <StatCard title="Payroll Readiness" value="0%" note="Not ready" icon={<WalletCards size={22} />} dark />
            </section>

            <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <ModuleCard title="Manager Action Centre" text="Approve leave, review employee notifications, and clear manager actions." icon={<Bell size={22} />} dark />
              <ModuleCard title="Roster Intelligence" text="Build weekly rosters, edit shifts and generate future schedules." icon={<CalendarDays size={22} />} />
              <ModuleCard title="Clocking Review" text="Review clocking problems, GPS checks and payroll blockers." icon={<Clock3 size={22} />} />
              <ModuleCard title="Workforce Movement" text="Handle transfers, terminations, temporary assignments and roster movement." icon={<Users size={22} />} />
              <ModuleCard title="HR Contract Centre" text="Save signed contracts under the employee without template admin." icon={<FileText size={22} />} />
              <ModuleCard title="Payroll Prep" text="Prepare clean, approved payroll-ready records before export." icon={<WalletCards size={22} />} dark />
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
