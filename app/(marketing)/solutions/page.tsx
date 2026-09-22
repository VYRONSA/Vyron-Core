import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { fallbackIcon, solutionIcons } from "@/components/marketing/umora/content";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { InsightCard } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { buildPageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Solutions | UMORA",
  description:
    "UMORA solutions for payroll leakage prevention, manager accountability, compliance, mobile workforce execution and operational intelligence.",
  path: "/solutions",
});

const solutionCards = [
  {
    title: "Payroll Leakage Prevention",
    text: "Detect missing, late and irregular attendance patterns before payroll finalisation.",
  },
  {
    title: "Manager Action Centre",
    text: "Turn unresolved workforce events into accountable manager workflows.",
  },
  {
    title: "Compliance Command",
    text: "Centralise HR cases, warnings and documentation for audit confidence.",
  },
  {
    title: "Mobile Workforce Execution",
    text: "Enable employee and manager action flows across branch and field operations.",
  },
  {
    title: "Operational Intelligence",
    text: "Combine workforce analytics and AI insight to prioritise what matters now.",
  },
  {
    title: "Enterprise Rollout",
    text: "Deploy by branch, region or business unit with structured governance support.",
  },
];

export default function SolutionsPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Solutions"
        title={
          <>
            Use-case execution <em>for operational teams.</em>
          </>
        }
        lead="UMORA supports operational, HR and payroll outcomes from one connected platform — so every exception has an owner and a next step."
        ctas={{ secondary: { href: "/features", label: "Explore features" } }}
        aside={<InsightCard />}
      />

      <Section label="Solutions">
        <div className={p.grid3}>
          {solutionCards.map((card) => {
            const Icon = solutionIcons[card.title] ?? fallbackIcon;
            return (
              <article key={card.title} className={p.card}>
                <span className={p.cardIconBadge}>
                  <Icon />
                </span>
                <h2 className={p.cardTitle}>{card.title}</h2>
                <p className={p.cardText}>{card.text}</p>
              </article>
            );
          })}
        </div>
        <div className={p.centerCta}>
          <Link href="/contact" className={`${s.btn} ${s.btnGold}`}>
            Book a solution demo <ArrowRight />
          </Link>
          <Link href="/industries" className={`${s.btn} ${p.btnGhostDark}`}>
            Browse industries
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
