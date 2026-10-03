import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buildPageMetadata } from "@/lib/marketing/site";
import { ecosystem, vyronsoft } from "@/lib/marketing/umora";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import s from "@/components/marketing/umora/umora.module.css";

// The VYRONSOFT software ecosystem, from the same approved data as the site
// footer. Only names, descriptors and official URLs are shown — no features,
// pricing or claims for the other products.
export const metadata: Metadata = buildPageMetadata({
  title: "VYRONSOFT Software Ecosystem | UMORA",
  description: `UMORA™ is part of the ${vyronsoft.legalName} software ecosystem: ${ecosystem
    .map((product) => product.name)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1")}.`,
  path: "/products",
});

export default function ProductsPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow={vyronsoft.legalName}
        title="VYRONSOFT Software Ecosystem"
        lead={`UMORA™ is one of ${ecosystem.length} products in the ${vyronsoft.legalName} software ecosystem.`}
        ctas={{ secondary: { href: "/pricing", label: "UMORA pricing" } }}
        compact
      />

      <Section label="VYRONSOFT Software Ecosystem">
        <ul className={`${p.grid3} ${p.suiteList}`}>
          {ecosystem.map((product) => (
            <li key={product.url} className={`${p.card} ${p.suite}`}>
              <h2 className={p.cardTitle}>
                <a href={product.url} className={p.suiteLink}>
                  {product.name}
                </a>
              </h2>
              <p className={p.cardText}>{product.descriptor}</p>
            </li>
          ))}
        </ul>
        <p className={p.suiteCorp}>
          <a href={vyronsoft.url} className={p.suiteLink}>
            {vyronsoft.legalName}
          </a>
          <span>{vyronsoft.statement}</span>
        </p>
        <div className={p.centerCta}>
          <Link href="/pricing" className={`${s.btn} ${s.btnGold}`}>
            See UMORA packages <ArrowRight />
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
