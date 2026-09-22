// UMORA brand constants and the fictional demo data shown in landing-page
// product visuals. Every number here is illustrative only and is labelled
// "Demo data" wherever it is rendered — none of it is customer data.

export const brand = {
  name: "UMORA",
  mark: "UMORA™",
  category: "Human & Workforce Intelligence",
  parent: "VYRONSOFT",
  statement: "Human intelligence applied to the way work happens.",
  tagline: "Your people are your business. Make them visible.",
  positioning:
    "From attendance and rostering to HR operations, payroll readiness and workforce intelligence — UMORA connects the entire working day in one intelligent platform.",
  pillars: ["People", "Time", "Work", "Intelligence"],
} as const;

export const seo = {
  title: "UMORA — Human & Workforce Intelligence",
  description:
    "UMORA connects people, attendance, rostering, HR operations, payroll readiness and workforce intelligence in one intelligent platform.",
} as const;

export const links = {
  demo: "/contact",
  start: "/signup",
  login: "/login",
  explore: "#platform",
} as const;

export const demoKpis = [
  { label: "Employees", value: "1,284", delta: "+3%", tone: "up" },
  { label: "Attendance", value: "94.8%", delta: "+1.2%", tone: "up" },
  { label: "Exceptions", value: "37", delta: "−18%", tone: "down" },
  { label: "Overtime risk", value: "R18,420", delta: "−26%", tone: "down" },
] as const;

// Attendance by weekday: share present (0–100) for the demo trend chart.
export const demoAttendanceWeek = [
  { day: "Mon", present: 93 },
  { day: "Tue", present: 95 },
  { day: "Wed", present: 96 },
  { day: "Thu", present: 94 },
  { day: "Fri", present: 91 },
  { day: "Sat", present: 97 },
  { day: "Sun", present: 98 },
];

// x/y are percentages on the stylised site map; align says which side of the
// dot the label sits so it never runs off the map edge.
export const demoSites = [
  { name: "Pretoria", employees: 186, attendance: "92%", x: 66, y: 14, align: "right" },
  { name: "Johannesburg", employees: 420, attendance: "95%", x: 58, y: 34, align: "right" },
  { name: "Durban", employees: 312, attendance: "93%", x: 84, y: 76, align: "right" },
  { name: "Head Office", employees: 118, attendance: "97%", x: 38, y: 52, align: "left" },
  { name: "Cape Town", employees: 248, attendance: "96%", x: 14, y: 84, align: "left" },
] as const;

export const demoRoster = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  rows: [
    { name: "T. Mokoena", shifts: ["08–17", "08–17", "OFF", "08–17", "08–17"] },
    { name: "S. Daniels", shifts: ["10–19", "10–19", "08–17", "OFF", "10–19"] },
    { name: "L. Naidoo", shifts: ["08–17", "08–17", "08–17", "08–17", "GAP"] },
    { name: "R. Pillay", shifts: ["OFF", "12–21", "12–21", "12–21", "12–21"] },
  ],
  stats: [
    { value: "96%", label: "Shift coverage" },
    { value: "2", label: "Understaffed windows" },
    { value: "1", label: "Overtime risk" },
  ],
};

export const demoActions = [
  { label: "Missing clock-out", count: 4, tone: "critical", who: "Branch 04 · Supervisor" },
  { label: "Late arrival", count: 7, tone: "high", who: "Cape Town · Store manager" },
  { label: "Overtime risk", count: 3, tone: "high", who: "Durban · Operations" },
  { label: "Leave approvals", count: 12, tone: "medium", who: "All sites · Line managers" },
  { label: "HR documents", count: 5, tone: "low", who: "Head Office · HR" },
] as const;

export const demoPayroll = {
  window: "7 days before payroll",
  items: [
    { count: 12, label: "Missing clock-outs" },
    { count: 8, label: "Overtime exceptions" },
    { count: 3, label: "Roster conflicts" },
    { count: 5, label: "Leave discrepancies" },
    { count: 2, label: "Attendance anomalies" },
  ],
  readiness: 94,
  attention: 6,
};

export const demoInsight = {
  headline: "Overtime increased 18% across Branch Group A over the last four weeks.",
  drivers: ["Increased Friday coverage", "Two roster gaps", "Repeated late clock-outs"],
  action: "Review Friday roster coverage.",
};
