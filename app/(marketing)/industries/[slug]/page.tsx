import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Flag, Gauge, Layers } from "lucide-react";
import { platformModules } from "@/components/marketing/umora/content";
import { PageHero, Section, SectionHead, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { Photo } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { buildPageMetadata, industries } from "@/lib/marketing/site";
import { industryImages } from "@/lib/marketing/umora-media";

type IndustryPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return industries.map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: IndustryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const industry = industries.find((item) => item.slug === slug);
  if (!industry) {
    return buildPageMetadata({
      title: "Industry | UMORA",
      description: "Industry-specific workforce intelligence workflows.",
      path: `/industries/${slug}`,
    });
  }

  return buildPageMetadata({
    title: `${industry.name} Workforce Intelligence | UMORA`,
    description: industry.detail,
    path: `/industries/${industry.slug}`,
  });
}

// The modules most teams in every industry start with.
const coreModules = ["Clocking", "Rostering", "Manager Actions", "Payroll Readiness"];

export default async function IndustryDetailPage({ params }: IndustryPageProps) {
  const { slug } = await params;
  const industry = industries.find((item) => item.slug === slug);

  if (!industry) {
    notFound();
  }

  const image = industryImages[industry.slug];
  const others = industries.filter((item) => item.slug !== industry.slug).slice(0, 5);

  return (
    <UmoraPage>
      <PageHero
        eyebrow="Industry solution"
        title={
          <>
            {industry.name} <em>workforce intelligence.</em>
          </>
        }
        lead={industry.detail}
        ctas={{ secondary: { href: "/industries", label: "All industries" } }}
        image={image}
      />

      <Section label={`${industry.name} challenge and outcome`}>
        <div className={p.grid3}>
          <article className={p.card}>
            <span className={p.cardIconBadge}>
              <Flag />
            </span>
            <h2 className={p.cardTitle}>Operational challenge</h2>
            <p className={p.cardText}>{industry.challenge}</p>
          </article>
          <article className={p.card}>
            <span className={p.cardIconBadge}>
              <Gauge />
            </span>
            <h2 className={p.cardTitle}>Target outcome</h2>
            <p className={p.cardText}>{industry.outcome}</p>
          </article>
          <article className={p.card}>
            <span className={p.cardIconBadge}>
              <Layers />
            </span>
            <h2 className={p.cardTitle}>Why UMORA</h2>
            <p className={p.cardText}>
              Unified attendance, HR, compliance and payroll readiness workflows with management accountability.
            </p>
          </article>
        </div>
      </Section>

      <Section tone="white" label="Where to start">
        <SectionHead
          eyebrow="Where teams start"
          title={`The core of UMORA for ${industry.name.toLowerCase()}.`}
        />
        <div className={p.grid4}>
          {platformModules
            .filter((m) => coreModules.includes(m.name))
            .map(({ icon: Icon, name, text }) => (
              <article key={name} className={p.card}>
                <Icon className={p.cardIcon} />
                <h3 className={p.cardTitle}>{name}</h3>
                <p className={p.cardText}>{text}</p>
              </article>
            ))}
        </div>
        <div className={p.centerCta}>
          <Link href="/contact" className={`${s.btn} ${s.btnGold}`}>
            Book a demo for {industry.name} <ArrowRight />
          </Link>
        </div>
      </Section>

      <Section label="Other industries">
        <SectionHead eyebrow="Other industries" title="Built for the way people actually work." />
        <ul className={p.tileStrip}>
          {others.map((other) => {
            const img = industryImages[other.slug];
            return (
              <li key={other.slug}>
                <Link href={`/industries/${other.slug}`} className={s.industry}>
                  {img ? <Photo image={img} sizes="(max-width: 760px) 50vw, 20vw" /> : null}
                  <span>{other.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    </UmoraPage>
  );
}
