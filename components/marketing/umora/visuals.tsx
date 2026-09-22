// Product visuals for the UMORA landing page. These are static renders of the
// real product surfaces, filled with the fictional demo data from
// lib/marketing/umora.ts, and each one carries a visible "Demo data" label.

import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Camera,
  Check,
  CircleAlert,
  Clock,
  FileText,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Sparkles,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {
  demoActions,
  demoAttendanceWeek,
  demoInsight,
  demoKpis,
  demoPayroll,
  demoRoster,
  demoSites,
} from "@/lib/marketing/umora";
import s from "./umora.module.css";

export function UmoraMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={s.mark}
    >
      <defs>
        <linearGradient id="umora-mark-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5EE0B4" />
          <stop offset="1" stopColor="#139B72" />
        </linearGradient>
        <linearGradient id="umora-mark-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F1D9A6" />
          <stop offset="1" stopColor="#C49A52" />
        </linearGradient>
      </defs>
      <rect x="4" y="3" width="10" height="26" rx="5" fill="url(#umora-mark-a)" />
      <rect x="18" y="9" width="10" height="20" rx="5" fill="url(#umora-mark-b)" />
    </svg>
  );
}

export function DemoBadge({ light = false }: { light?: boolean }) {
  return <span className={`${s.demoBadge} ${light ? s.demoBadgeLight : ""}`}>Demo data</span>;
}

const sidebar = [
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: Users, label: "Employees" },
  { icon: Clock, label: "Clocking" },
  { icon: CalendarDays, label: "Rostering" },
  { icon: CalendarRange, label: "Leave" },
  { icon: Briefcase, label: "HR Operations" },
  { icon: ListChecks, label: "Manager Actions" },
  { icon: Wallet, label: "Payroll Readiness" },
  { icon: BarChart3, label: "Reports" },
  { icon: Sparkles, label: "Intelligence" },
];

const siteMix = [
  { name: "Johannesburg", share: 33, color: "#1FB889" },
  { name: "Durban", share: 24, color: "#D9B878" },
  { name: "Cape Town", share: 19, color: "#5B8DEF" },
  { name: "Pretoria", share: 15, color: "#8FA3BF" },
  { name: "Head Office", share: 9, color: "#E8E2D4" },
];

function donutGradient() {
  let at = 0;
  const stops = siteMix.map((site) => {
    const from = at;
    at += site.share;
    return `${site.color} ${from}% ${at}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function HeroDashboard() {
  return (
    <div className={s.dash} role="img" aria-label="UMORA workforce overview dashboard with demo data">
      <aside className={s.dashSide} aria-hidden="true">
        <div className={s.dashBrand}>
          <UmoraMark size={18} />
          <span>UMORA</span>
        </div>
        {sidebar.map(({ icon: Icon, label, active }) => (
          <div key={label} className={`${s.dashNav} ${active ? s.dashNavActive : ""}`}>
            <Icon size={13} strokeWidth={2} />
            <span>{label}</span>
          </div>
        ))}
      </aside>

      <div className={s.dashMain} aria-hidden="true">
        <div className={s.dashTop}>
          <div>
            <div className={s.dashTitle}>Workforce overview</div>
            <div className={s.dashSub}>All sites · Last 30 days</div>
          </div>
          <div className={s.dashTopRight}>
            <DemoBadge light />
            <Bell size={14} />
          </div>
        </div>

        <div className={s.dashKpis}>
          {demoKpis.map((kpi) => (
            <div key={kpi.label} className={s.dashKpi}>
              <div className={s.dashKpiValue}>{kpi.value}</div>
              <div className={s.dashKpiLabel}>{kpi.label}</div>
              <div className={s.dashKpiDelta}>{kpi.delta}</div>
            </div>
          ))}
        </div>

        <div className={s.dashRow}>
          <div className={s.dashCard}>
            <div className={s.dashCardHead}>
              <span>Attendance trend</span>
              <span className={s.dashLegend}>
                <i style={{ background: "#1FB889" }} /> Present
              </span>
            </div>
            <div className={s.bars}>
              {demoAttendanceWeek.map((d, i) => (
                <div key={d.day} className={s.barCol}>
                  <span
                    className={s.bar}
                    style={{ height: `${(d.present - 80) * 5}%`, animationDelay: `${i * 70}ms` }}
                  />
                  <em>{d.day}</em>
                </div>
              ))}
            </div>
          </div>

          <div className={s.dashCard}>
            <div className={s.dashCardHead}>
              <span>Employees by site</span>
            </div>
            <div className={s.donutWrap}>
              <div className={s.donut} style={{ background: donutGradient() }} />
              <ul className={s.donutLegend}>
                {siteMix.map((site) => (
                  <li key={site.name}>
                    <i style={{ background: site.color }} />
                    {site.name}
                    <b>{site.share}%</b>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className={s.dashRow}>
          <div className={`${s.dashCard} ${s.dashReady}`}>
            <Ring value={demoPayroll.readiness} size={46} stroke={5} />
            <div>
              <div className={s.dashCardTitle}>Payroll readiness</div>
              <div className={s.dashSub}>{demoPayroll.attention} items need attention</div>
            </div>
          </div>
          <div className={`${s.dashCard} ${s.dashInsight}`}>
            <Sparkles size={14} />
            <div>
              <div className={s.dashCardTitle}>Workforce insight</div>
              <div className={s.dashSub}>Friday overtime is trending up at Branch Group A.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Ring({
  value,
  size = 120,
  stroke = 10,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={s.ring} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={s.ringTrack} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#umora-ring)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="umora-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5EE0B4" />
          <stop offset="1" stopColor="#1FB889" />
        </linearGradient>
      </defs>
      {label ? (
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className={s.ringText}>
          {label}
        </text>
      ) : null}
    </svg>
  );
}

export function SiteMap() {
  const hub = demoSites.find((site) => site.name === "Head Office")!;
  return (
    <div className={s.map}>
      <svg className={s.mapLines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {demoSites
          .filter((site) => site !== hub)
          .map((site) => (
            <line
              key={site.name}
              x1={hub.x}
              y1={hub.y}
              x2={site.x}
              y2={site.y}
              stroke="rgba(94,224,180,0.35)"
              strokeWidth="0.25"
              strokeDasharray="1 1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </svg>
      {demoSites.map((site, i) => (
        <div
          key={site.name}
          className={`${s.mapNode} ${site.align === "right" ? s.mapNodeRight : ""}`}
          style={{ left: `${site.x}%`, top: `${site.y}%`, animationDelay: `${i * 400}ms` }}
        >
          <span className={s.mapDot} />
          <div className={s.mapLabel}>
            <strong>{site.name}</strong>
            <span>
              {site.employees} employees · {site.attendance} attendance
            </span>
          </div>
        </div>
      ))}
      <div className={s.mapBadge}>
        <DemoBadge />
      </div>
    </div>
  );
}

export function ClockingPhone() {
  return (
    <div className={s.phone} role="img" aria-label="Employee clock-in screen with demo data">
      <div className={s.phoneNotch} />
      <div className={s.phoneScreen} aria-hidden="true">
        <div className={s.phoneStatus}>
          <span>07:58</span>
          <DemoBadge />
        </div>
        <div className={s.phoneClock}>07:58</div>
        <div className={s.phoneDate}>Monday · Morning shift</div>
        <div className={s.phoneAvatar}>
          <UserRound size={44} strokeWidth={1.4} />
          <span className={s.phoneAvatarCheck}>
            <Camera size={12} />
          </span>
        </div>
        <div className={s.phoneState}>
          <Check size={14} strokeWidth={3} /> Clocked in
        </div>
        <div className={s.phoneSite}>
          <MapPin size={13} /> Cape Town — Branch 04
        </div>
        <ul className={s.phoneChecks}>
          <li>
            <Check size={12} strokeWidth={3} /> Photo verified
          </li>
          <li>
            <Check size={12} strokeWidth={3} /> GPS verified
          </li>
        </ul>
        <div className={s.phoneTimes}>
          <div>
            <span>Scheduled</span>
            <strong>08:00</strong>
          </div>
          <div>
            <span>Actual</span>
            <strong className={s.emerald}>07:58</strong>
          </div>
        </div>
        <div className={s.phoneButton}>View my day</div>
      </div>
    </div>
  );
}

export function RosterBoard() {
  return (
    <div className={s.panel} role="img" aria-label="Weekly roster board with demo data">
      <div className={s.panelHead} aria-hidden="true">
        <div>
          <div className={s.panelTitle}>Weekly roster</div>
          <div className={s.panelSub}>Branch 04 · Front of house</div>
        </div>
        <DemoBadge light />
      </div>
      <div className={s.rosterScroll} aria-hidden="true">
        <table className={s.roster}>
          <thead>
            <tr>
              <th>Employee</th>
              {demoRoster.days.map((day) => (
                <th key={day}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {demoRoster.rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                {row.shifts.map((shift, i) => (
                  <td key={`${row.name}-${i}`}>
                    <span
                      className={`${s.shift} ${
                        shift === "OFF" ? s.shiftOff : shift === "GAP" ? s.shiftGap : ""
                      }`}
                    >
                      {shift === "GAP" ? "Unfilled" : shift}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.rosterStats} aria-hidden="true">
        {demoRoster.stats.map((stat, i) => (
          <div key={stat.label} className={i === 0 ? s.statGood : s.statWarn}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const toneClass: Record<string, string> = {
  critical: s.toneCritical,
  high: s.toneHigh,
  medium: s.toneMedium,
  low: s.toneLow,
};

export function ActionCentre() {
  return (
    <div className={`${s.panel} ${s.panelDark}`} role="img" aria-label="Manager Action Centre queue with demo data">
      <div className={s.panelHead} aria-hidden="true">
        <div>
          <div className={s.panelTitle}>Today</div>
          <div className={s.panelSub}>31 open actions · sorted by priority</div>
        </div>
        <DemoBadge />
      </div>
      <ul className={s.actions} aria-hidden="true">
        {demoActions.map((action) => (
          <li key={action.label} className={s.actionRow}>
            <span className={`${s.actionDot} ${toneClass[action.tone]}`} />
            <div className={s.actionText}>
              <strong>{action.label}</strong>
              <span>{action.who}</span>
            </div>
            <span className={s.actionCount}>{action.count}</span>
            <div className={s.actionBtns}>
              <span>Review</span>
              <span>Resolve</span>
              <span>Close</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PayrollReadiness() {
  return (
    <div className={s.payroll} role="img" aria-label="Payroll readiness check with demo data">
      <div className={s.panel} aria-hidden="true">
        <div className={s.panelHead}>
          <div>
            <div className={s.panelTitle}>{demoPayroll.window}</div>
            <div className={s.panelSub}>Exceptions to clear before export</div>
          </div>
          <DemoBadge light />
        </div>
        <ul className={s.payrollList}>
          {demoPayroll.items.map((item) => (
            <li key={item.label}>
              <b>{item.count}</b>
              <span>{item.label}</span>
              <CircleAlert size={14} />
            </li>
          ))}
        </ul>
      </div>
      <div className={s.payrollGauge} aria-hidden="true">
        <div className={s.payrollGaugeTitle}>Payroll readiness</div>
        <Ring value={demoPayroll.readiness} size={148} stroke={12} label={`${demoPayroll.readiness}%`} />
        <div className={s.payrollGaugeReady}>Ready</div>
        <div className={s.payrollGaugeNote}>{demoPayroll.attention} items need attention</div>
      </div>
    </div>
  );
}

export function InsightCard() {
  return (
    <div className={s.insight} role="img" aria-label="Example UMORA workforce insight with demo data">
      <div className={s.insightHead} aria-hidden="true">
        <span className={s.insightTag}>
          <Sparkles size={13} /> UMORA insight
        </span>
        <DemoBadge />
      </div>
      <p className={s.insightHeadline} aria-hidden="true">
        {demoInsight.headline}
      </p>
      <div className={s.insightChart} aria-hidden="true">
        {[42, 46, 51, 49, 55, 58, 63, 68].map((v, i) => (
          <span key={i} style={{ height: `${v}%` }} className={i > 4 ? s.insightBarHot : undefined} />
        ))}
      </div>
      <div className={s.insightGrid} aria-hidden="true">
        <div>
          <div className={s.insightLabel}>Possible drivers</div>
          <ul>
            {demoInsight.drivers.map((driver) => (
              <li key={driver}>{driver}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className={s.insightLabel}>Recommended action</div>
          <p className={s.insightAction}>{demoInsight.action}</p>
          <span className={s.insightOwner}>Owner: Regional operations manager</span>
        </div>
      </div>
    </div>
  );
}

const employeeApp = [
  { icon: Clock, label: "Clock in", hint: "GPS + photo" },
  { icon: Clock, label: "Clock out", hint: "Shift summary" },
  { icon: CalendarRange, label: "Leave", hint: "Request & balance" },
  { icon: FileText, label: "Documents", hint: "Payslips & letters" },
  { icon: UserRound, label: "Profile", hint: "My details" },
];

const managerApp = [
  { icon: Users, label: "Attendance", hint: "Who is on site" },
  { icon: Check, label: "Approvals", hint: "Leave & overtime" },
  { icon: CircleAlert, label: "Exceptions", hint: "Late · missing" },
  { icon: Users, label: "Team", hint: "Roster & status" },
  { icon: ListChecks, label: "Actions", hint: "Next best step" },
];

function MiniPhone({
  title,
  who,
  items,
  accent,
}: {
  title: string;
  who: string;
  items: typeof employeeApp;
  accent: "emerald" | "gold";
}) {
  return (
    <div className={`${s.phone} ${s.phoneMini}`} role="img" aria-label={`${title} mobile app`}>
      <div className={s.phoneNotch} />
      <div className={s.phoneScreen} aria-hidden="true">
        <div className={s.miniHead}>
          <span className={accent === "gold" ? s.miniPillGold : s.miniPill}>{title}</span>
          <span className={s.miniWho}>{who}</span>
        </div>
        <ul className={s.miniList}>
          {items.map(({ icon: Icon, label, hint }) => (
            <li key={label}>
              <span className={accent === "gold" ? s.miniIconGold : s.miniIcon}>
                <Icon size={15} />
              </span>
              <div>
                <strong>{label}</strong>
                <em>{hint}</em>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MobilePair() {
  return (
    <div className={s.mobilePair}>
      <MiniPhone title="Employee" who="Self-service" items={employeeApp} accent="emerald" />
      <MiniPhone title="Manager" who="On the floor" items={managerApp} accent="gold" />
    </div>
  );
}
