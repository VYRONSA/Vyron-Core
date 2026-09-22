import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import PricingEstimator from "@/components/marketing/PricingEstimator";
import { PageHero, Section, SectionHead, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import s from "@/components/marketing/umora/umora.module.css";
import { buildPageMetadata, comparisonHeaders, comparisonRows, plans, siteName } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing | UMORA",
  description: "UMORA pricing for Launch, Starter, Growth, Professional, Business and Enterprise teams.",
  path: "/pricing",
});

function splitPrice(price: string) {
  const match = price.match(/^(R[\d,]+)(\/month)?\s*(.*)$/);
  if (!match) return { amount: price, unit: "" };
  return { amount: match[1], unit: [match[2], match[3]].filter(Boolean).join(" ") };
}

export default function PricingPage() {
  const oursIndex = comparisonHeaders.indexOf(siteName);

  return (
    <UmoraPage>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Packages that grow <em>with your workforce.</em>
          </>
        }
        lead="Every package includes the core UMORA workforce platform, with advanced controls as you scale. Prices are monthly and exclude VAT."
        ctas={{ secondary: { href: "#plans", label: "Compare packages" } }}
        compact
      />

      <Section id="plans" label="Packages">
        <div className={p.grid3}>
          {plans.map((plan) => {
            const { amount, unit } = splitPrice(plan.price);
            const toSales = plan.cta.includes("Sales") || plan.cta.includes("Demo");
            return (
              <article key={plan.name} className={`${p.plan} ${plan.highlight ? p.planFeatured : ""}`}>
                {plan.highlight ? <span className={p.planBadge}>Most popular</span> : null}
                <h2 className={p.planName}>{plan.name}</h2>
                <p className={p.planPeople}>{plan.people}</p>
                <p className={p.planPrice}>
                  {amount} {unit ? <small>{unit}</small> : null}
                </p>
                <ul className={p.checklist}>
                  {plan.includes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className={p.planCta}>
                  <Link
                    href={toSales ? "/contact" : "/signup"}
                    className={`${s.btn} ${plan.highlight ? s.btnGold : p.btnDark}`}
                  >
                    {plan.cta} <ArrowRight />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      <Section tone="white" label="Plan guide">
        <PricingEstimator />
      </Section>

      <Section label="Comparison">
        <SectionHead
          eyebrow="Comparison"
          title="Capability depth at a glance."
          lead="How UMORA compares with traditional clocking systems and traditional HR software."
        />
        <div className={p.tableWrap}>
          <table className={p.table}>
            <thead>
              <tr>
                {comparisonHeaders.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row[0]}>
                  {row.map((col, i) => (
                    <td key={`${row[0]}-${i}`} className={i === oursIndex ? p.ours : undefined}>
                      {col}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </UmoraPage>
  );
}
