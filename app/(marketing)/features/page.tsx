import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { fallbackIcon, groupIcons, platformModules } from "@/components/marketing/umora/content";
import { PageHero, Section, SectionHead, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { HeroDashboard } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { buildPageMetadata, featureMatrix } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Features | UMORA",
  description:
    "Explore every UMORA module across people, clocking, rostering, leave, HR operations, compliance, payroll readiness and workforce intelligence.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Features"
        title={
          <>
            Every part of the working day. <em>One intelligent platform.</em>
          </>
        }
        lead="UMORA combines employee management, verified attendance, rostering, HR operations, compliance and payroll readiness — with the intelligence to show managers what needs attention next."
        ctas={{ secondary: { href: "/pricing", label: "View pricing" } }}
        aside={<HeroDashboard />}
      />

      <Section label="Platform modules">
        <SectionHead
          eyebrow="The platform"
          title="One workforce. One intelligent platform."
          lead="Ten connected modules share one employee record, one timeline and one set of rules."
        />
        <div className={p.grid5}>
          {platformModules.map(({ icon: Icon, name, text }) => (
            <article key={name} className={p.card}>
              <Icon className={p.cardIcon} />
              <h3 className={p.cardTitle}>{name}</h3>
              <p className={p.cardText}>{text}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="white" label="Module breakdown">
        <SectionHead
          eyebrow="Module breakdown"
          title="Grouped by operational outcome."
          lead="What each part of UMORA does in practice."
        />
        <div className={p.grid3}>
          {featureMatrix.map((group) => {
            const Icon = groupIcons[group.group] ?? fallbackIcon;
            return (
              <article key={group.group} className={p.card}>
                <span className={p.cardIconBadge}>
                  <Icon />
                </span>
                <h3 className={p.cardTitle}>{group.group}</h3>
                <ul className={p.checklist}>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
        <div className={p.centerCta}>
          <Link href="/contact" className={`${s.btn} ${s.btnGold}`}>
            Book a feature demo <ArrowRight />
          </Link>
          <Link href="/solutions" className={`${s.btn} ${p.btnGhostDark}`}>
            See solutions
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
