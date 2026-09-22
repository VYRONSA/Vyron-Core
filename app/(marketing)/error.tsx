"use client";

import Link from "next/link";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import s from "@/components/marketing/umora/umora.module.css";

// Public pages never show the raw error message to visitors.
export default function MarketingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Something went wrong"
        title="We couldn't load this page."
        lead="Please try again. If it keeps happening, contact us and we'll help."
        ctas={false}
        compact
      />
      <Section label="Try again">
        <div className={p.centerCta} style={{ marginTop: 0 }}>
          <button type="button" onClick={reset} className={`${s.btn} ${s.btnGold}`} style={{ border: 0, cursor: "pointer" }}>
            Try again
          </button>
          <Link href="/" className={`${s.btn} ${p.btnGhostDark}`}>
            Go home
          </Link>
        </div>
      </Section>
    </UmoraPage>
  );
}
