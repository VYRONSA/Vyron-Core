import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import s from "@/components/marketing/umora/umora.module.css";

export default function MarketingNotFound() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Page not found"
        title={
          <>
            This page <em>doesn&apos;t exist.</em>
          </>
        }
        lead="The link may be out of date, or the page may have moved."
        ctas={false}
        compact
      />
      <Section label="Where to next">
        <div className={p.centerCta} style={{ marginTop: 0 }}>
          <Link href="/" className={`${s.btn} ${s.btnGold}`}>
            Go to the UMORA home page <ArrowRight />
          </Link>
          <Link href="/contact" className={`${s.btn} ${p.btnGhostDark}`}>
            Contact us
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
