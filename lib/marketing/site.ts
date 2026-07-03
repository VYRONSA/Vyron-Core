import type { Metadata } from "next";

export const siteName = "VYRON CORE";
export const siteDescription =
  "VYRON CORE is South Africa's AI Workforce Intelligence Platform for employee management, attendance, HR operations, compliance, and payroll readiness.";

const defaultSiteUrl = "https://www.vyroncore.com";

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || defaultSiteUrl;

export type Industry = {
  slug: string;
  name: string;
  challenge: string;
  outcome: string;
  detail: string;
};

export const industries: Industry[] = [
  {
    slug: "retail",
    name: "Retail",
    challenge: "High staff rotation and branch-level attendance risk",
    outcome: "Store-level labor control with payroll-ready hours",
    detail:
      "Track attendance by branch, detect late arrivals instantly, and keep payroll clean across shifts, part-time workers, and peak trade periods.",
  },
  {
    slug: "hospitality",
    name: "Hospitality",
    challenge: "Variable shifts and overtime leakage",
    outcome: "Real-time staffing visibility across properties",
    detail:
      "Coordinate teams across venues, manage overtime risk before payroll closes, and keep leave and discipline workflows centrally controlled.",
  },
  {
    slug: "restaurants",
    name: "Restaurants",
    challenge: "Rush-hour scheduling pressure and clock integrity",
    outcome: "Reliable clocking with photo and GPS verification",
    detail:
      "Align labor to demand windows, prevent buddy clocking, and manage leave approvals with manager accountability in one command center.",
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    challenge: "Shift compliance and complex labor allocation",
    outcome: "Audit-ready attendance with exception intelligence",
    detail:
      "Enforce site-level attendance rules, monitor shift handovers, and route workforce exceptions to the right manager before they become payroll disputes.",
  },
  {
    slug: "logistics",
    name: "Logistics",
    challenge: "Distributed teams and movement-heavy operations",
    outcome: "Location-aware workforce operations at scale",
    detail:
      "Validate field and depot attendance, track site movement, and standardize leave and HR case handling across regions.",
  },
  {
    slug: "security",
    name: "Security",
    challenge: "Remote sites and strict guard accountability",
    outcome: "Verified site clocking and rapid incident workflows",
    detail:
      "Prove guard presence at every site, monitor non-compliance early, and maintain complete HR and warning records for risk control.",
  },
  {
    slug: "cleaning",
    name: "Cleaning",
    challenge: "Multi-site crews and frequent schedule changes",
    outcome: "Reliable roster execution and attendance proof",
    detail:
      "Keep mobile teams on schedule, capture verified attendance at customer sites, and improve labor billing confidence.",
  },
  {
    slug: "construction",
    name: "Construction",
    challenge: "Site access control and subcontractor oversight",
    outcome: "Project-ready workforce governance",
    detail:
      "Track labor per site, enforce attendance controls, and maintain documentation and disciplinary history with full traceability.",
  },
  {
    slug: "mining-contractors",
    name: "Mining Contractors",
    challenge: "Compliance-heavy environments with remote teams",
    outcome: "Operational compliance with full evidence trails",
    detail:
      "Support strict attendance governance, produce verifiable records, and identify payroll and compliance exceptions before close.",
  },
  {
    slug: "agriculture",
    name: "Agriculture",
    challenge: "Seasonal labor peaks and field-based attendance",
    outcome: "Scalable workforce control during harvest cycles",
    detail:
      "Manage temporary teams, verify field attendance, and run leave and payroll readiness processes reliably during high-volume periods.",
  },
  {
    slug: "field-service",
    name: "Field Service",
    challenge: "Off-site teams with variable daily routes",
    outcome: "Mobile-first workforce intelligence",
    detail:
      "Give managers route-aware attendance visibility, automate exception handling, and keep workforce operations consistent across service regions.",
  },
];

export const coreFeatures = [
  "Workforce Intelligence",
  "GPS and Photo Clocking",
  "Payroll Readiness",
  "Leave Management",
  "Rostering",
  "Manager Action Centre",
  "HR Cases",
  "Compliance",
  "AI Insights",
  "Mobile Workforce",
  "Documents",
  "Real-time Analytics",
];

export const featureMatrix = [
  {
    group: "Employee Management",
    items: [
      "Digital employee records with branch and role context",
      "Onboarding-ready profile capture",
      "Structured employee lifecycle tracking",
    ],
  },
  {
    group: "Clocking",
    items: [
      "GPS-verified clock-in and clock-out",
      "Live photo verification for attendance integrity",
      "Exception triggers for late, missing, and anomalous events",
    ],
  },
  {
    group: "Leave",
    items: [
      "Digital leave requests and approvals",
      "Policy-aware leave visibility",
      "Manager feedback and decision audit",
    ],
  },
  {
    group: "HR",
    items: [
      "HR case management and workflow routing",
      "Disciplinary warning register",
      "Employee document vault",
    ],
  },
  {
    group: "Compliance",
    items: [
      "Policy tracking and status monitoring",
      "Exception escalation with ownership",
      "Audit-ready historical records",
    ],
  },
  {
    group: "Payroll Readiness",
    items: [
      "Daily payroll risk monitoring",
      "Overtime visibility before export",
      "Exception-to-resolution workflow",
    ],
  },
  {
    group: "Analytics",
    items: [
      "Workforce trend views by team and site",
      "Attendance and leave performance KPIs",
      "Manager accountability reporting",
    ],
  },
  {
    group: "AI Intelligence",
    items: [
      "Risk surfacing before payroll close",
      "Operational insight recommendations",
      "Pattern detection for workforce exceptions",
    ],
  },
  {
    group: "Operations",
    items: [
      "Manager Action Centre for daily priorities",
      "Exception triage and closure workflows",
      "Branch and region operating visibility",
    ],
  },
  {
    group: "Mobile",
    items: [
      "Employee self-service actions",
      "Mobile attendance and leave workflows",
      "On-the-go manager approvals",
    ],
  },
  {
    group: "Reports",
    items: [
      "Payroll readiness reports",
      "Compliance and HR case reports",
      "Historical workforce trend exports",
    ],
  },
];

export const showcaseModules = [
  {
    name: "Dashboard",
    route: "/login",
    description:
      "Live enterprise command view for workforce status, exception priorities, and management actions.",
  },
  {
    name: "Employees",
    route: "/employees",
    description: "Centralized employee directory and workforce profile controls.",
  },
  {
    name: "Clocking",
    route: "/clock",
    description: "GPS and photo-verification clocking controls with review workflows.",
  },
  {
    name: "Leave",
    route: "/leave",
    description: "Digital leave lifecycle from request through policy-aware approval.",
  },
  {
    name: "Manager Action Centre",
    route: "/operations",
    description: "Priority-driven manager queue for unresolved workforce actions.",
  },
  {
    name: "Payroll Readiness",
    route: "/payroll-readiness",
    description: "Pre-payroll risk controls and readiness tracking.",
  },
  {
    name: "Documents",
    route: "/products",
    description: "Secure HR and compliance document workflows.",
  },
  {
    name: "HR Cases",
    route: "/hr-warnings",
    description: "Structured HR case and warning handling with full history.",
  },
];

export const outcomes = [
  {
    before: "Manual attendance",
    after: "GPS verified attendance",
  },
  {
    before: "Payroll surprises",
    after: "Payroll ready every day",
  },
  {
    before: "Paper leave forms",
    after: "Digital workflows",
  },
  {
    before: "Unknown overtime",
    after: "Real-time alerts",
  },
  {
    before: "Manual HR administration",
    after: "AI-powered workforce intelligence",
  },
];

export type Plan = {
  name: string;
  people: string;
  price: string;
  highlight?: boolean;
  cta: string;
  includes: string[];
};

export const plans: Plan[] = [
  {
    name: "Launch",
    people: "Up to 20 employees",
    price: "R1,499/month excl. VAT",
    cta: "Start Free Trial",
    includes: [
      "Employee Management",
      "GPS and Photo Clocking",
      "Leave Management",
      "Basic Reports",
      "Mobile Self Service",
    ],
  },
  {
    name: "Starter",
    people: "Up to 50 employees",
    price: "R2,999/month excl. VAT",
    cta: "Start Free Trial",
    includes: [
      "Everything in Launch",
      "Rostering",
      "Payroll Readiness",
      "Manager Action Centre",
      "HR Cases",
    ],
  },
  {
    name: "Growth",
    people: "Up to 100 employees",
    price: "R4,999/month excl. VAT",
    highlight: true,
    cta: "Book a Demo",
    includes: [
      "Everything in Starter",
      "Disciplinary Warnings",
      "Document Management",
      "Compliance Tracking",
      "AI Workforce Insights",
    ],
  },
  {
    name: "Professional",
    people: "Up to 250 employees",
    price: "R8,999/month excl. VAT",
    cta: "Book a Demo",
    includes: [
      "Everything in Growth",
      "Advanced Analytics",
      "Branch-level Controls",
      "Operational Exception Workflows",
      "Priority Support",
    ],
  },
  {
    name: "Business",
    people: "Up to 500 employees",
    price: "R14,999/month excl. VAT",
    cta: "Talk to Sales",
    includes: [
      "Everything in Professional",
      "Advanced Governance",
      "Multi-entity Controls",
      "Enterprise Integrations",
      "Executive Reporting",
    ],
  },
  {
    name: "Enterprise",
    people: "500+ employees",
    price: "Contact Sales",
    cta: "Contact Sales",
    includes: [
      "Unlimited enterprise scale",
      "Custom onboarding",
      "Dedicated success team",
      "Security and compliance alignment",
      "Tailored commercial model",
    ],
  },
];

export const comparisonHeaders = [
  "Capability",
  "Traditional Clocking",
  "Traditional HR Software",
  "VYRON CORE",
];

export const comparisonRows = [
  ["GPS Clocking", "Limited", "No", "Yes"],
  ["Photo Verification", "No", "No", "Yes"],
  ["Leave Management", "Basic", "Yes", "Yes"],
  ["HR Cases", "No", "Partial", "Yes"],
  ["Rostering", "Partial", "No", "Yes"],
  ["Payroll Readiness", "No", "Partial", "Yes"],
  ["AI Workforce Intelligence", "No", "No", "Yes"],
  ["Manager Action Centre", "No", "No", "Yes"],
  ["Compliance Workflows", "Partial", "Partial", "Yes"],
  ["Reports", "Basic", "Basic", "Advanced"],
  ["Analytics", "Low", "Medium", "Enterprise"],
];

export const faqs = [
  {
    q: "Can employees clock in from site?",
    a: "Yes. VYRON CORE supports location-aware clocking for distributed workforces.",
  },
  {
    q: "Can GPS be disabled?",
    a: "GPS policies are configurable by company requirements and governance rules.",
  },
  {
    q: "Does it work on mobile?",
    a: "Yes. Mobile employee self-service and manager approvals are supported.",
  },
  {
    q: "Can it integrate with payroll?",
    a: "Payroll export readiness workflows are available and can align with your payroll process.",
  },
  {
    q: "How long is implementation?",
    a: "Implementation timelines depend on workforce size, branch complexity, and data readiness.",
  },
  {
    q: "Can multiple branches be managed?",
    a: "Yes. VYRON CORE is designed for multi-branch and multi-site operations.",
  },
  {
    q: "How secure is employee data?",
    a: "The platform uses enterprise-grade controls and role-based access practices.",
  },
  {
    q: "Can managers approve leave from mobile?",
    a: "Yes. Leave actions are available through mobile-friendly workflows.",
  },
  {
    q: "Do you support disciplinary warnings?",
    a: "Yes. Warning workflows and records are built into the HR operations layer.",
  },
  {
    q: "Can we track overtime risk before payroll?",
    a: "Yes. Payroll readiness highlights overtime and attendance risk before close.",
  },
  {
    q: "Can contractors and field teams be managed?",
    a: "Yes. Field operations and distributed teams are supported across industries.",
  },
  {
    q: "Is there a manager action queue?",
    a: "Yes. Manager Action Centre prioritizes unresolved workforce tasks.",
  },
  {
    q: "Can we store HR documents in the platform?",
    a: "Yes. Document workflows support centralized operational records.",
  },
  {
    q: "Do you provide analytics?",
    a: "Yes. Workforce, compliance, and payroll readiness analytics are included.",
  },
  {
    q: "Can we start with a pilot?",
    a: "Yes. Teams often begin with a guided rollout to prove outcomes quickly.",
  },
];

export const resources = [
  {
    title: "Payroll Leakage Prevention Framework",
    category: "Guide",
    summary:
      "A practical framework to identify and resolve attendance, overtime, and approval leaks before payroll export.",
  },
  {
    title: "Manager Action Centre Playbook",
    category: "Operations",
    summary:
      "How operations leaders reduce unresolved workforce tasks through daily management routines.",
  },
  {
    title: "HR Cases and Compliance Readiness",
    category: "Compliance",
    summary:
      "A guide to building consistent HR workflows and audit-ready case handling.",
  },
  {
    title: "Workforce Intelligence for Multi-Branch Teams",
    category: "Insight",
    summary:
      "How distributed employers use data visibility to improve labor control and team performance.",
  },
  {
    title: "Mobile Employee Self Service Rollout",
    category: "Implementation",
    summary:
      "A deployment checklist for introducing mobile workforce workflows in active operations.",
  },
  {
    title: "Rostering and Leave Governance",
    category: "Guide",
    summary:
      "How to align leave approvals and roster plans with business continuity goals.",
  },
];

export const navItems = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/industries", label: "Industries" },
  { href: "/pricing", label: "Pricing" },
  { href: "/solutions", label: "Solutions" },
  { href: "/about", label: "About" },
  { href: "/resources", label: "Resources" },
  { href: "/contact", label: "Contact" },
];

export function buildPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = `${siteUrl}${input.path}`;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    openGraph: {
      title: input.title,
      description: input.description,
      type: "website",
      url: canonical,
      siteName,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
    },
  };
}
