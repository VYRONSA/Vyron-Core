import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "About | VYRON CORE",
  description: "Learn why VYRON CORE exists and how it helps employers control workforce operations with intelligence and accountability.",
  path: "/about",
});

export default function AboutPage() {
  return (
      <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>About</span>
            <h1 className={styles.h1}>Built to eliminate workforce blind spots.</h1>
            <p className={styles.lead}>
              VYRON CORE exists to help organizations stop payroll leakage, improve workforce discipline, and move from
              reactive administration to intelligent operational control.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              <article className={styles.card}>
                <h3>Vision</h3>
                <p className={styles.muted}>
                  A future where workforce execution is measurable, compliant, and intelligence-driven across every
                  branch and site.
                </p>
              </article>
              <article className={styles.card}>
                <h3>Mission</h3>
                <p className={styles.muted}>
                  Deliver one enterprise platform that unifies employee operations, attendance integrity, HR workflows,
                  and payroll readiness.
                </p>
              </article>
              <article className={styles.card}>
                <h3>Why VYRON CORE</h3>
                <p className={styles.muted}>
                  Existing tools are fragmented. VYRON CORE gives operations leaders one command layer for daily
                  decision-making and accountability.
                </p>
              </article>
            </div>

            <div className={styles.actions}>
              <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                Talk to the team
              </Link>
              <Link href="/resources" className={`${styles.btn} ${styles.btnSecondary}`}>
                Explore resources
              </Link>
            </div>
          </div>
        </section>
      </main>
  );
}
