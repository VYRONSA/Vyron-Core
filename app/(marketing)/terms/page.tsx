import type { Metadata } from "next";
import { siteUrl } from "@/lib/marketing/site";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";

// Legal wording is reproduced exactly as approved; only the page layout uses
// the UMORA visual system. "VYRON Software" is the company named in the policy.
export const metadata: Metadata = {
  title: "Terms of Service | VYRON Software",
  alternates: { canonical: `${siteUrl}/terms` },
};

export default function TermsPage() {
  return (
    <UmoraPage>
      <PageHero eyebrow="Legal" title="Terms of Service" ctas={false} compact />
      <Section label="Terms of Service">
        <div className={p.legal}>
          <p className={p.legalMeta}>Effective date: 15 May 2026</p>
          <p>This website provides general information about VYRON Software, its products and SaaS solutions.</p>
          <p>Product features, availability and pricing may change as products develop.</p>
          <p>For questions, contact info@vyronsoft.co.za.</p>
        </div>
      </Section>
    </UmoraPage>
  );
}
