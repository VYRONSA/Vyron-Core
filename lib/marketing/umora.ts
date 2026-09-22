// UMORA brand constants and the fictional demo data shown in landing-page
// product visuals. Every number here is illustrative only; the visuals label
// it as demo data ("Demo Company" / "Demo data") wherever it is rendered —
// none of it is customer data.

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
  features: "/features",
} as const;

export const demoKpis = [
  { label: "Employees", value: "1,284", delta: "3%", dir: "up", good: true },
  { label: "Attendance", value: "94.8%", delta: "1.2%", dir: "up", good: true },
  { label: "Exceptions", value: "37", delta: "18%", dir: "down", good: false },
  { label: "Overtime Risk", value: "R18,420", delta: "26%", dir: "down", good: false },
] as const;

// Attendance by weekday: share present, for the demo trend chart.
export const demoAttendanceWeek = [
  { day: "Mon", present: 58 },
  { day: "Tue", present: 74 },
  { day: "Wed", present: 66 },
  { day: "Thu", present: 69 },
  { day: "Fri", present: 82 },
  { day: "Sat", present: 78 },
  { day: "Sun", present: 88 },
];

export const demoSiteMix = [
  { name: "Head Office", share: 18, color: "#3b82f6" },
  { name: "Cape Town", share: 22, color: "#22c55e" },
  { name: "JHB", share: 20, color: "#f59e0b" },
  { name: "Durban", share: 15, color: "#fb923c" },
  { name: "Pretoria", share: 12, color: "#0ea5e9" },
  { name: "Other", share: 13, color: "#8b5cf6" },
];

// x/y are percentages on the stylised map; label says where the caption sits.
export const demoSites = [
  { name: "Pretoria", employees: 186, attendance: "92%", x: 38, y: 24, label: "right" },
  { name: "JHB", employees: 420, attendance: "95%", x: 64, y: 15, label: "right" },
  { name: "Durban", employees: 312, attendance: "93%", x: 72, y: 52, label: "right" },
  { name: "Head Office", employees: 118, attendance: "97%", x: 42, y: 67, label: "right" },
  { name: "Cape Town", employees: 248, attendance: "96%", x: 10, y: 55, label: "below" },
] as const;

export const demoRoster = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  rows: [
    { name: "T. Mokoena", shifts: ["08–17", "08–17", "OFF", "08–17", "08–17"] },
    { name: "S. Daniels", shifts: ["10–19", "10–19", "08–17", "OFF", "10–19"] },
    { name: "L. Naidoo", shifts: ["08–17", "08–17", "08–17", "08–17", "OFF"] },
  ],
  stats: [
    { value: "96%", label: "Shift Coverage", tone: "good" },
    { value: "2", label: "Understaffed Windows", tone: "bad" },
    { value: "1", label: "Overtime Risk", tone: "bad" },
  ],
};

export const demoActions = [
  { label: "Missing clock-out", count: 4, tone: "critical" },
  { label: "Late arrival", count: 7, tone: "high" },
  { label: "Overtime risk", count: 3, tone: "high" },
  { label: "Leave approvals", count: 12, tone: "ok" },
  { label: "HR documents", count: 5, tone: "ok" },
] as const;

export const demoPayroll = {
  window: "7 Days Before Payroll",
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
