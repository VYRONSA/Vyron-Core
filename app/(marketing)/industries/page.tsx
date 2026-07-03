import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata, industries } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Industries | VYRON CORE",
  description: "See how VYRON CORE solves workforce challenges across retail, hospitality, logistics, field service, and compliance-heavy sectors.",
  path: "/industries",
});

export default function IndustriesPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Industries</span>
            <h1 className={styles.h1}>Purpose-built for high-accountability operations.</h1>
            <p className={styles.lead}>
              From retail to mining contractors, VYRON CORE adapts to each workforce model while preserving governance,
              attendance integrity, and payroll readiness.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {industries.map((industry) => (
                <article key={industry.slug} className={styles.card}>
                  <h3>{industry.name}</h3>
                  <p className={styles.muted}>{industry.detail}</p>
                  <ul className={styles.list}>
                    <li>
                      <span className={styles.dot} />
                      {industry.challenge}
                    </li>
                    <li>
                      <span className={styles.dot} />
                      {industry.outcome}
                    </li>
                  </ul>
                  <div className={styles.actions}>
                    <Link href={`/industries/${industry.slug}`} className={`${styles.btn} ${styles.btnSecondary}`}>
                      Industry page
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
  );
}
