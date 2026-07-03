import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata, coreFeatures, featureMatrix } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Features | VYRON CORE",
  description: "Explore every VYRON CORE module across workforce intelligence, HR operations, compliance, and payroll readiness.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Features</span>
            <h1 className={styles.h1}>Deep platform capabilities for workforce execution.</h1>
            <p className={styles.lead}>
              VYRON CORE combines employee management, attendance controls, HR operations, and intelligence tooling in
              one production-ready enterprise platform.
            </p>
            <div className={`${styles.grid} ${styles.grid4}`} style={{ marginTop: "1.2rem" }}>
              {coreFeatures.map((feature) => (
                <article key={feature} className={styles.card}>
                  <h3>{feature}</h3>
                  <p className={styles.muted}>
                    Built to reduce management latency, strengthen compliance confidence, and improve payroll accuracy.
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Module Breakdown</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Grouped by operational outcomes.
            </h2>
            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {featureMatrix.map((group) => (
                <article key={group.group} className={styles.card}>
                  <h3>{group.group}</h3>
                  <ul className={styles.list}>
                    {group.items.map((item) => (
                      <li key={item}>
                        <span className={styles.dot} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <div className={styles.actions}>
              <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                Book a feature demo
              </Link>
              <Link href="/pricing" className={`${styles.btn} ${styles.btnSecondary}`}>
                View pricing
              </Link>
            </div>
          </div>
        </section>
      </main>
  );
}
