import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { buildPageMetadata, industries } from "@/lib/marketing/site";
import { industryImages } from "@/lib/marketing/umora-media";

export const metadata: Metadata = buildPageMetadata({
  title: "Industries | UMORA",
  description:
    "How UMORA supports retail, hospitality, restaurants, manufacturing, logistics, security, cleaning, construction, mining, agriculture and field service teams.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Industries"
        title={
          <>
            Built for the way <em>people actually work.</em>
          </>
        }
        lead="From retail floors to mining contractors, UMORA adapts to each workforce model while keeping attendance integrity, governance and payroll readiness intact."
        ctas={{ secondary: { href: "/solutions", label: "See solutions" } }}
        compact
      />

      <Section label="Industries we serve">
        <div className={p.grid3}>
          {industries.map((industry) => {
            const img = industryImages[industry.slug];
            return (
              <Link key={industry.slug} href={`/industries/${industry.slug}`} className={p.photoCard}>
                <div className={p.photoCardImg}>
                  {img ? <Image src={img.src} alt={img.alt} fill sizes="(max-width: 760px) 100vw, (max-width: 1024px) 50vw, 33vw" style={{ objectPosition: img.position }} /> : null}
                  <span>{industry.name}</span>
                </div>
                <div className={p.photoCardBody}>
                  <p className={p.cardText}>{industry.detail}</p>
                  <ul className={p.checklist}>
                    <li>{industry.challenge}</li>
                    <li>{industry.outcome}</li>
                  </ul>
                  <span className={`${p.link} ${p.cardFoot}`}>
                    {industry.name} in detail <ArrowRight />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </Section>
    </UmoraPage>
  );
}
