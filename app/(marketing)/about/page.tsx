import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Target, Users } from "lucide-react";
import { PageHero, Section, SectionHead, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { Photo } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { buildPageMetadata } from "@/lib/marketing/site";
import { brand } from "@/lib/marketing/umora";
import { workforcePortraits } from "@/lib/marketing/umora-media";

export const metadata: Metadata = buildPageMetadata({
  title: "About | UMORA",
  description:
    "Why UMORA exists: human intelligence applied to the way work happens. A VYRONSOFT product for workforce visibility, accountability and payroll readiness.",
  path: "/about",
});

const pillars = [
  {
    icon: Compass,
    title: "Vision",
    text: "A future where workforce execution is measurable, compliant and intelligence-driven across every branch and site.",
  },
  {
    icon: Target,
    title: "Mission",
    text: "Deliver one platform that unifies employee operations, attendance integrity, HR workflows and payroll readiness.",
  },
  {
    icon: Users,
    title: "Why UMORA",
    text: "Existing tools are fragmented. UMORA gives operations leaders one command layer for daily decision-making and accountability.",
  },
];

export default function AboutPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="About UMORA"
        title={
          <>
            Built to eliminate <em>workforce blind spots.</em>
          </>
        }
        lead="UMORA exists to help organisations stop payroll leakage, improve workforce discipline and move from reactive administration to intelligent operational control."
        ctas={{ secondary: { href: "/resources", label: "Explore resources" } }}
        aside={
          <ul className={p.portraitRow}>
            {workforcePortraits.map((portrait) => (
              <li key={portrait.label}>
                <Photo image={portrait} sizes="(max-width: 760px) 44vw, 12vw" />
              </li>
            ))}
          </ul>
        }
      />

      <Section label="Vision and mission">
        <div className={p.grid3}>
          {pillars.map(({ icon: Icon, title, text }) => (
            <article key={title} className={p.card}>
              <span className={p.cardIconBadge}>
                <Icon />
              </span>
              <h2 className={p.cardTitle}>{title}</h2>
              <p className={p.cardText}>{text}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="dark" label="The UMORA name">
        <div className={p.split}>
          <div>
            <SectionHead
              light
              eyebrow="The name"
              title={`${brand.name} — ${brand.category}`}
              lead={
                <>
                  UMORA is inspired by the Italian <em>umano</em> — human. Every business depends on people, and the
                  working day is where their effort, time and judgement turn into results.
                </>
              }
            />
            <ul className={p.pillars}>
              {brand.pillars.map((pillar) => (
                <li key={pillar}>{pillar}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className={p.statement}>&ldquo;{brand.statement}&rdquo;</p>
            <p className={p.headLead} style={{ color: "#d8e0e5" }}>
              UMORA is a {brand.parent} product.
            </p>
            <div className={p.heroCtas}>
              <Link href="/contact" className={`${s.btn} ${s.btnGold}`}>
                Talk to the team <ArrowRight />
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </UmoraPage>
  );
}
