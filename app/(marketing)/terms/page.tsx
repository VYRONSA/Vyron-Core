const products = [
  {
    name: "VYRON CORE",
    icon: "🛡",
    accent: "#0ea5e9",
    text: "Workforce control, HR, payroll readiness and compliance management.",
    points: ["HR & Employee Management", "Clocking, Rostering & Leave", "Warnings & Disciplinary Records", "Payroll Readiness & Compliance", "AI Workforce Insights"],
  },
  {
    name: "VYRON REACH",
    icon: "📣",
    accent: "#8b5cf6",
    text: "Marketing command centre for campaigns, leads and growth.",
    points: ["Campaign Management", "Lead Generation & Outreach", "Content Planning", "Pipeline Tracking", "Growth Visibility"],
  },
  {
    name: "VYRON COST",
    icon: "🟢",
    accent: "#22c55e",
    text: "Costing and operational finance intelligence platform.",
    points: ["Supplier Costs", "Food Costing", "VAT-Aware Reporting", "Cost Leakage Detection", "Management Visibility"],
  },
  {
    name: "VYRON MAINT",
    icon: "🔧",
    accent: "#f97316",
    text: "Maintenance management for properties, units and assets.",
    points: ["Tickets & SLA", "Technicians", "Before/After Photos", "Risk Tracking", "Performance"],
  },
  {
    name: "VYRON FARM",
    icon: "🌿",
    accent: "#65a30d",
    text: "Farm and livestock management for agricultural operations.",
    points: ["Cattle Records", "Breeding", "Health Records", "Stock & Inventory", "Farm Tasks"],
  },
  {
    name: "VYRON BUILD",
    icon: "🚧",
    accent: "#fb5a14",
    text: "Construction and build-phase project management.",
    points: ["Project Management", "Contractors", "Progress Tracking", "Snag Lists", "Site Documents"],
  },
  {
    name: "VYRON RECRUIT",
    icon: "👥",
    accent: "#7c3aed",
    text: "Recruitment command centre for hiring and talent acquisition.",
    points: ["Job Posting", "Applicant Tracking", "Hiring Workflows", "Candidate Pipelines", "Acquisition Insights"],
  },
  {
    name: "VYRON AI",
    icon: "✦",
    accent: "#0ea5e9",
    text: "AI-powered intelligence across all VYRON platforms.",
    points: ["AI Insights", "Smart Recommendations", "Automated Reporting", "Anomaly Detection", "Future Automation"],
  },
];

export const metadata = { title: "Terms of Service | VYRON Software" };

export default function TermsPage() {
  return (
    <main className="page-simple">
      <div className="container legal">
        <h1>Terms of Service</h1>
        <p>Effective date: 15 May 2026</p>
        <p>This website provides general information about VYRON Software, its products and SaaS solutions.</p>
        <p>Product features, availability and pricing may change as products develop.</p>
        <p>For questions, contact info@vyronsoft.co.za.</p>
      </div>
    </main>
  );
}
