// Product visuals for the UMORA landing page, drawn to match the approved
// design reference. They are static renders of the real product surfaces,
// filled with the fictional demo data from lib/marketing/umora.ts. Each mockup
// is sized in `em` against a container-query font size, so it scales as one
// piece instead of reflowing into something that no longer looks like the UI.

import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  FileText,
  FolderCheck,
  History,
  LayoutDashboard,
  ListChecks,
  Search,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  demoActions,
  demoAttendanceWeek,
  demoInsight,
  demoKpis,
  demoPayroll,
  demoRoster,
  demoSiteMix,
  demoSites,
} from "@/lib/marketing/umora";
import { clockInSelfie } from "@/lib/marketing/umora-media";
import s from "./umora.module.css";

/* ------------------------------------------------------------------ brand */

export function UmoraMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={`${s.mark} ${className ?? ""}`}
    >
      <defs>
        <linearGradient id="umora-mark-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ef0c7" />
          <stop offset="1" stopColor="#1fb28a" />
        </linearGradient>
        <linearGradient id="umora-mark-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ec5a8" />
          <stop offset="1" stopColor="#0f7f6c" />
        </linearGradient>
      </defs>
      <path d="M3 5.5a2.5 2.5 0 0 1 2.5-2.5h5a2.5 2.5 0 0 1 2.5 2.5V29H5.5A2.5 2.5 0 0 1 3 26.5Z" fill="url(#umora-mark-a)" />
      <path d="M15 8.5 25.6 3.4A2.5 2.5 0 0 1 29 5.7v20.8a2.5 2.5 0 0 1-2.5 2.5H15Z" fill="url(#umora-mark-b)" />
    </svg>
  );
}

export function UmoraLogo({ sub = true, size = "md" }: { sub?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`${s.logo} ${size === "lg" ? s.logoLg : ""}`}>
      <span className={s.logoRow}>
        <UmoraMark className={s.logoMark} />
        <span className={s.logoWord}>UMORA</span>
      </span>
      {sub ? <span className={s.logoSub}>Human &amp; Workforce Intelligence</span> : null}
    </span>
  );
}

export function DemoTag({ dark = false }: { dark?: boolean }) {
  return <span className={`${s.demoTag} ${dark ? s.demoTagDark : ""}`}>Demo data</span>;
}

/** Hand-drawn underline used under the script lettering. */
export function Swoosh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M4 34 C 60 26, 120 16, 196 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------------------------------------------------- hero dashboard */

const sidebar: { icon: LucideIcon; label: string; active?: boolean; more?: boolean }[] = [
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: Users, label: "Employees" },
  { icon: Clock, label: "Clocking" },
  { icon: CalendarDays, label: "Rostering" },
  { icon: CalendarRange, label: "Leave" },
  { icon: Briefcase, label: "HR Operations", more: true },
  { icon: ListChecks, label: "Manager Actions", more: true },
  { icon: Wallet, label: "Payroll Readiness" },
  { icon: BarChart3, label: "Reports" },
  { icon: Sparkles, label: "Intelligence" },
];

function donut() {
  let at = 0;
  return `conic-gradient(${demoSiteMix
    .map((site) => {
      const from = at;
      at += site.share;
      return `${site.color} ${from}% ${at}%`;
    })
    .join(", ")})`;
}

export function HeroDashboard() {
  return (
    <div className={s.dashWrap}>
      <div className={s.dash} role="img" aria-label="UMORA workforce overview dashboard for a demo company">
        <aside className={s.dashSide} aria-hidden="true">
          <div className={s.dashBrand}>
            <span>UMORA</span>
            <em>Workforce intelligence</em>
          </div>
          {sidebar.map(({ icon: Icon, label, active, more }) => (
            <div key={label} className={`${s.dashNav} ${active ? s.dashNavActive : ""}`}>
              <Icon />
              <span>{label}</span>
              {more ? <ChevronRight className={s.dashNavMore} /> : null}
            </div>
          ))}
        </aside>

        <div className={s.dashMain} aria-hidden="true">
          <div className={s.dashBar}>
            <div className={s.dashSearch}>
              <Search />
            </div>
            <div className={s.dashCompany}>
              Demo Company <ChevronDown />
            </div>
            <SlidersHorizontal className={s.dashFilter} />
            <span className={s.dashAvatar}>JS</span>
          </div>

          <div className={s.dashHead}>
            <strong>Workforce Overview</strong>
            <span className={s.dashRange}>
              Last 30 Days <ChevronDown />
            </span>
          </div>

          <div className={s.dashKpis}>
            {demoKpis.map((kpi) => (
              <div key={kpi.label} className={s.dashKpi}>
                <b>{kpi.value}</b>
                <span>{kpi.label}</span>
                <em className={kpi.good ? s.up : s.down}>
                  {kpi.dir === "up" ? <ArrowUp /> : <ArrowDown />} {kpi.delta}
                </em>
              </div>
            ))}
          </div>

          <div className={s.dashCharts}>
            <div className={s.dashCard}>
              <div className={s.dashCardHead}>Attendance Trend</div>
              <div className={s.dashLegend}>
                <span>
                  <i className={s.dotBlue} /> Present
                </span>
                <span>
                  <i className={s.dotOrange} /> Absent
                </span>
              </div>
              <div className={s.chart}>
                <div className={s.chartAxis}>
                  <span>1.0k</span>
                  <span>0.5k</span>
                  <span>0</span>
                </div>
                <div className={s.chartBars}>
                  {demoAttendanceWeek.map((d, i) => (
                    <div key={d.day} className={s.chartCol}>
                      <span className={s.chartBar} style={{ height: `${d.present}%`, animationDelay: `${i * 60}ms` }} />
                      <em>{d.day}</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={s.dashCard}>
              <div className={s.dashCardHead}>Employees by Site</div>
              <div className={s.donutRow}>
                <div className={s.donut} style={{ background: donut() }} />
                <ul className={s.donutLegend}>
                  {demoSiteMix.map((site) => (
                    <li key={site.name}>
                      <i style={{ background: site.color }} />
                      <span>{site.name}</span>
                      <b>{site.share}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- map */

export function WorkforceMap() {
  return (
    <div className={s.map}>
      <svg className={s.mapArt} viewBox="0 0 600 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="umora-map-glow" cx="45%" cy="45%" r="60%">
            <stop offset="0" stopColor="#1e4b4a" stopOpacity="0.9" />
            <stop offset="1" stopColor="#0a1a24" stopOpacity="0" />
          </radialGradient>
          <pattern id="umora-map-dots" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#5ad6a8" opacity="0.18" />
          </pattern>
        </defs>
        {/* stylised landmass */}
        <path
          d="M40 150 C 60 120, 90 110, 120 96 C 150 80, 170 50, 210 40 C 250 30, 300 20, 350 18 C 400 16, 440 8, 480 22 C 520 36, 560 60, 600 70 L 600 260 L 60 260 C 50 230, 30 200, 40 150 Z"
          fill="#0f2430"
          opacity="0.85"
        />
        <path
          d="M40 150 C 60 120, 90 110, 120 96 C 150 80, 170 50, 210 40 C 250 30, 300 20, 350 18 C 400 16, 440 8, 480 22 C 520 36, 560 60, 600 70 L 600 260 L 60 260 C 50 230, 30 200, 40 150 Z"
          fill="url(#umora-map-dots)"
        />
        <rect width="600" height="260" fill="url(#umora-map-glow)" />
        {/* road network */}
        <g fill="none" stroke="#2fd39a" strokeWidth="0.8" opacity="0.35">
          <path d="M70 150 C 140 120, 200 90, 250 70 S 360 40, 400 30" />
          <path d="M250 70 C 260 110, 262 150, 270 190" />
          <path d="M400 30 C 420 70, 440 110, 450 140" />
          <path d="M270 190 C 330 170, 390 150, 450 140" />
          <path d="M120 96 C 150 140, 190 170, 270 190" />
          <path d="M400 30 C 460 40, 520 60, 590 90" />
          <path d="M450 140 C 500 160, 560 170, 600 200" />
          <path d="M180 60 C 200 110, 230 150, 230 220" />
        </g>
        <g fill="none" stroke="#f0c56a" strokeWidth="0.9" strokeDasharray="2 3" opacity="0.55">
          <path d="M70 150 C 140 110, 190 85, 250 70" />
        </g>
        {/* city lights */}
        <g fill="#f0d49a" opacity="0.5">
          {Array.from({ length: 70 }).map((_, i) => {
            const x = 160 + ((i * 37) % 110);
            const y = 60 + ((i * 53) % 90);
            return <circle key={i} cx={x} cy={y} r={0.7} />;
          })}
        </g>
      </svg>

      {demoSites.map((site, i) => (
        <div
          key={site.name}
          className={`${s.mapNode} ${site.label === "below" ? s.mapNodeBelow : ""}`}
          style={{ left: `${site.x}%`, top: `${site.y}%`, animationDelay: `${i * 450}ms` }}
        >
          <span className={s.mapDot} />
          <span className={s.mapText}>
            <strong>{site.name}</strong>
            <span>{site.employees} employees</span>
            <span>{site.attendance} attendance</span>
          </span>
        </div>
      ))}
      <span className={s.mapTag}>
        <DemoTag dark />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ clock phone */

export function ClockPhone() {
  return (
    <div className={s.phoneWrap}>
      <div className={s.phone} role="img" aria-label="Employee clock-in screen showing a verified clock-in (demo data)">
        <span className={s.phoneIsland} />
        <div className={s.phoneScreen} aria-hidden="true">
          <div className={s.pcTime}>07:58</div>
          <div className={s.pcDate}>Mon, 22 Sep 2026</div>
          <div className={s.pcAvatar}>
            <Image src={clockInSelfie.src} alt="" fill sizes="120px" />
          </div>
          <div className={s.pcState}>Clocked In</div>
          <div className={s.pcSite}>Cape Town — Branch 04</div>
          <ul className={s.pcChecks}>
            <li>
              <Check /> Photo Verified
            </li>
            <li>
              <Check /> GPS Verified
            </li>
          </ul>
          <div className={s.pcTimes}>
            <div>
              <span>Scheduled</span>
              <b>08:00</b>
            </div>
            <div>
              <span>Actual</span>
              <b className={s.pcActual}>07:58</b>
            </div>
          </div>
          <div className={s.pcButton}>View My Day</div>
          <div className={s.pcDemo}>Demo data</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- roster */

export function RosterTable() {
  return (
    <div className={s.rosterBox} role="img" aria-label="Weekly roster with shift coverage (demo data)">
      <table className={s.roster} aria-hidden="true">
        <thead>
          <tr>
            <th>Employee</th>
            {demoRoster.days.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {demoRoster.rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              {row.shifts.map((shift, i) => (
                <td key={i} className={shift === "OFF" ? s.off : undefined}>
                  {shift}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={s.rosterStats} aria-hidden="true">
        {demoRoster.stats.map((stat) => (
          <div key={stat.label}>
            <b className={stat.tone === "good" ? s.good : s.bad}>{stat.value}</b>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- action centre */

const actionTone: Record<string, string> = {
  critical: s.toneCritical,
  high: s.toneHigh,
  ok: s.toneOk,
};

export function ActionTable() {
  return (
    <div className={s.actionBox} role="img" aria-label="Manager Action Centre queue for today (demo data)">
      <div className={s.actionHead} aria-hidden="true">
        Today
      </div>
      <ul aria-hidden="true">
        {demoActions.map((a) => (
          <li key={a.label}>
            <span className={`${s.actionIcon} ${actionTone[a.tone]}`}>
              {a.tone === "ok" ? <Check /> : <CircleAlert />}
            </span>
            <span className={s.actionLabel}>{a.label}</span>
            <b className={`${s.actionCount} ${actionTone[a.tone]}`}>{a.count}</b>
            <span className={s.actionBtns}>
              <span>Review</span>
              <span>Resolve</span>
              <span>Close</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- payroll */

export function Ring({ value, label }: { value: number; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className={s.ring} aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="#3ddc84"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`}
        transform="rotate(-90 50 50)"
        className={s.ringArc}
      />
      <text x="50" y="53" textAnchor="middle" dominantBaseline="middle" className={s.ringText}>
        {label}
      </text>
    </svg>
  );
}

export function PayrollBoard() {
  return (
    <div className={s.payroll} role="img" aria-label="Payroll readiness: 94% ready, 6 items need attention (demo data)">
      <div className={s.payrollList} aria-hidden="true">
        <div className={s.payrollHead}>{demoPayroll.window}</div>
        <ul>
          {demoPayroll.items.map((item) => (
            <li key={item.label}>
              <b>{item.count}</b>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={s.payrollGauge} aria-hidden="true">
        <span>Payroll Readiness</span>
        <Ring value={demoPayroll.readiness} label={`${demoPayroll.readiness}%`} />
        <em>{demoPayroll.attention} Items Need Attention</em>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- insight */

export function InsightCard() {
  return (
    <div className={s.insight} role="img" aria-label="Example UMORA workforce insight (demo data)">
      <div className={s.insightTop} aria-hidden="true">
        <span className={s.insightBars}>
          <i />
          <i />
          <i />
          <i />
        </span>
        <div>
          <span className={s.insightTag}>UMORA Insight</span>
          <p>{demoInsight.headline}</p>
        </div>
      </div>
      <div className={s.insightCols} aria-hidden="true">
        <div>
          <b>Possible drivers</b>
          <ul>
            {demoInsight.drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <b>Recommended action</b>
          <p>{demoInsight.action}</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- HR flow */

const hrSteps: { icon: LucideIcon; label: string; tone: string }[] = [
  { icon: UserRound, label: "Employee", tone: s.hrGreen },
  { icon: FolderCheck, label: "Case", tone: s.hrTeal },
  { icon: TriangleAlert, label: "Warning", tone: s.hrOrange },
  { icon: FileText, label: "Document", tone: s.hrBlue },
  { icon: UserRound, label: "Manager", tone: s.hrBlue },
  { icon: Check, label: "Resolution", tone: s.hrGreen },
  { icon: History, label: "History", tone: s.hrPurple },
];

export function HrFlow() {
  return (
    <ol className={s.hrFlow}>
      {hrSteps.map(({ icon: Icon, label, tone }) => (
        <li key={label}>
          <span className={`${s.hrIcon} ${tone}`}>
            <Icon />
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ app phones */

const employeeItems: { icon: LucideIcon; label: string; tone: string; muted?: boolean }[] = [
  { icon: Clock, label: "Clock In", tone: s.appGreen },
  { icon: Clock, label: "Clock Out", tone: s.appPurple, muted: true },
  { icon: CalendarRange, label: "Leave", tone: s.appGreen },
  { icon: FileText, label: "Documents", tone: s.appBlue },
  { icon: UserRound, label: "Profile", tone: s.appBlue },
];

const managerItems: { icon: LucideIcon; label: string; tone: string; muted?: boolean }[] = [
  { icon: CalendarDays, label: "Attendance", tone: s.appRed },
  { icon: Check, label: "Approvals", tone: s.appOrange },
  { icon: TriangleAlert, label: "Exceptions", tone: s.appRed },
  { icon: Users, label: "Team", tone: s.appBlue },
  { icon: ListChecks, label: "Actions", tone: s.appOrange },
];

function AppPhone({ title, items }: { title: string; items: typeof employeeItems }) {
  return (
    <div className={s.appPhone} role="img" aria-label={`UMORA ${title.toLowerCase()} app: ${items.map((i) => i.label).join(", ")}`}>
      <span className={s.phoneIsland} />
      <div className={s.appScreen} aria-hidden="true">
        <div className={s.appHead}>
          <UmoraMark className={s.appMark} />
          <span>{title}</span>
        </div>
        <ul className={s.appList}>
          {items.map(({ icon: Icon, label, tone, muted }) => (
            <li key={label} className={muted ? s.appMuted : undefined}>
              <span className={`${s.appIcon} ${tone}`}>
                <Icon />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AppPhones() {
  return (
    <div className={s.appPair}>
      <AppPhone title="Employee" items={employeeItems} />
      <AppPhone title="Manager" items={managerItems} />
    </div>
  );
}
