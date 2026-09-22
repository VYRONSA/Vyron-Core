import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { buildPageMetadata, resources } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Resources | UMORA",
  description: "Guides and operational playbooks for workforce intelligence, HR governance and payroll readiness.",
  path: "/resources",
});

export default function ResourcesPage() {
  const categories = [...new Set(resources.map((r) => r.category))];

  return (
    <UmoraPage>
      <PageHero
        eyebrow="Resources"
        title={
          <>
            Guides and playbooks <em>for operations leaders.</em>
          </>
        }
        lead="Practical guidance for operations, HR and payroll teams on attendance integrity, manager accountability and payroll readiness. Request any guide and our team will send it to you."
        ctas={false}
        compact
      />

      <Section label="Resource library">
        <ul className={p.chips} aria-label="Resource categories">
          {categories.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className={p.grid3}>
          {resources.map((resource) => (
            <article key={resource.title} className={p.card}>
              <p className={p.cardEyebrow}>{resource.category}</p>
              <h2 className={p.cardTitle}>{resource.title}</h2>
              <p className={p.cardText}>{resource.summary}</p>
              <div className={p.cardFoot}>
                <Link href="/contact" className={p.link}>
                  Request this guide <ArrowRight />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </Section>
    </UmoraPage>
  );
}
