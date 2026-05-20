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

function Header() {
  return (
    <header className="header">
      <div className="container nav">
        <a href="/" className="logo">
          <div className="mark" />
          <div className="logo-text">
            <strong>VYRON</strong>
            <span>SOFTWARE</span>
          </div>
        </a>

        <nav className="nav-links">
          <a href="/">Home</a>
          <a href="/products">Products⌄</a>
          <a href="/products">Solutions⌄</a>
          <a href="/about">About Us</a>
          <a href="/privacy">Resources⌄</a>
          <a href="/contact">Contact</a>
        </nav>

        <a className="demo-btn" href="/contact">Book a Demo</a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-row">
        <span>© 2026 VYRON Software. Built in South Africa.</span>
        <span>info@vyronsoft.co.za · www.vyronsoft.co.za</span>
        <span className="footer-links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/contact">Contact</a>
        </span>
      </div>
    </footer>
  );
}
export const metadata = { title: "Contact | VYRON Software" };

export default function ContactPage() {
  return (
    <div className="site">
      <Header />
      <main className="page-simple">
        <div className="container legal">
          <span className="pill">CONTACT VYRON</span>
          <h1>Book a demo or send an enquiry.</h1>
          <p>Email: info@vyronsoft.co.za</p>
          <p>Phone: South Africa</p>
          <p>Location: South Africa</p>
          <p>Website: www.vyronsoft.co.za</p>
          <div className="actions">
            <a className="primary" href="mailto:info@vyronsoft.co.za">Email VYRON →</a>
            <a className="secondary" href="/products">View Products →</a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
