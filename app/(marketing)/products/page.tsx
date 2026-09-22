import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Calculator,
  Megaphone,
  Sparkles,
  Sprout,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { siteUrl } from "@/lib/marketing/site";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { UmoraMark } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";

// The VYRONSOFT product suite. UMORA is this site's product; the other suite
// products keep their current names until the company confirms their brands.
type Product = {
  name: string;
  icon: LucideIcon | "umora";
  accent: string;
  text: string;
  points: string[];
  href: string;
};

const products: Product[] = [
  {
    name: "UMORA",
    icon: "umora",
    accent: "#1e9e67",
    text: "Human & Workforce Intelligence — workforce control, HR, payroll readiness and compliance management.",
    points: [
      "HR & Employee Management",
      "Clocking, Rostering & Leave",
      "Warnings & Disciplinary Records",
      "Payroll Readiness & Compliance",
      "AI Workforce Insights",
    ],
    href: "/",
  },
  {
    name: "VYRON REACH",
    icon: Megaphone,
    accent: "#8b5cf6",
    text: "Marketing command centre for campaigns, leads and growth.",
    points: ["Campaign Management", "Lead Generation & Outreach", "Content Planning", "Pipeline Tracking", "Growth Visibility"],
    href: "/contact",
  },
  {
    name: "VYRON COST",
    icon: Calculator,
    accent: "#22c55e",
    text: "Costing and operational finance intelligence platform.",
    points: ["Supplier Costs", "Food Costing", "VAT-Aware Reporting", "Cost Leakage Detection", "Management Visibility"],
    href: "/contact",
  },
  {
    name: "VYRON MAINT",
    icon: Wrench,
    accent: "#f97316",
    text: "Maintenance management for properties, units and assets.",
    points: ["Tickets & SLA", "Technicians", "Before/After Photos", "Risk Tracking", "Performance"],
    href: "/contact",
  },
  {
    name: "VYRON FARM",
    icon: Sprout,
    accent: "#65a30d",
    text: "Farm and livestock management for agricultural operations.",
    points: ["Cattle Records", "Breeding", "Health Records", "Stock & Inventory", "Farm Tasks"],
    href: "/contact",
  },
  {
    name: "VYRON BUILD",
    icon: Building2,
    accent: "#fb5a14",
    text: "Construction and build-phase project management.",
    points: ["Project Management", "Contractors", "Progress Tracking", "Snag Lists", "Site Documents"],
    href: "/contact",
  },
  {
    name: "VYRON RECRUIT",
    icon: UserPlus,
    accent: "#7c3aed",
    text: "Recruitment command centre for hiring and talent acquisition.",
    points: ["Job Posting", "Applicant Tracking", "Hiring Workflows", "Candidate Pipelines", "Acquisition Insights"],
    href: "/contact",
  },
  {
    name: "VYRON AI",
    icon: Sparkles,
    accent: "#0ea5e9",
    text: "AI-powered intelligence across all VYRON platforms.",
    points: ["AI Insights", "Smart Recommendations", "Automated Reporting", "Anomaly Detection", "Future Automation"],
    href: "/contact",
  },
];

export const metadata: Metadata = {
  title: "Products | VYRON Software",
  alternates: { canonical: `${siteUrl}/products` },
};

export default function ProductsPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="VYRON product suite"
        title="The complete VYRON product suite"
        lead="Explore the VYRON software products built for workforce control, marketing, costing, maintenance, farming, construction, recruitment and AI-powered operations."
        ctas={{ secondary: { href: "/pricing", label: "UMORA pricing" } }}
        compact
      />

      <Section label="Products">
        <div className={p.grid4}>
          {products.map((product) => {
            const Icon = product.icon;
            return (
              <article
                key={product.name}
                className={`${p.card} ${p.suite}`}
                style={{ "--accent": product.accent } as React.CSSProperties}
              >
                {Icon === "umora" ? (
                  <UmoraMark size={34} />
                ) : (
                  <Icon className={p.cardIcon} style={{ color: product.accent }} />
                )}
                <h2 className={p.cardTitle}>{product.name}</h2>
                <p className={p.cardText}>{product.text}</p>
                <ul className={p.checklist}>
                  {product.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className={p.cardFoot}>
                  <Link href={product.href} className={p.link}>
                    {product.href === "/" ? "Explore UMORA" : "Enquire"} <ArrowRight />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
        <div className={p.centerCta}>
          <Link href="/pricing" className={`${s.btn} ${s.btnGold}`}>
            See UMORA packages <ArrowRight />
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
