import type { Metadata } from "next";
import Link from "next/link";
import PricingEstimator from "@/components/marketing/PricingEstimator";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata, comparisonHeaders, comparisonRows, plans } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing | VYRON CORE",
  description: "Transparent VYRON CORE pricing for Launch, Starter, Growth, Professional, Business, and Enterprise teams.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Pricing</span>
            <h1 className={styles.h1}>Premium packages for workforce growth.</h1>
            <p className={styles.lead}>
              Every package includes production-ready workforce tooling, with advanced controls as you scale.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {plans.map((plan) => (
                <article
                  key={plan.name}
                  className={styles.card}
                  style={
                    plan.highlight
                      ? {
                          borderColor: "rgba(6,197,255,0.6)",
                          boxShadow: "0 24px 72px rgba(6,197,255,0.2)",
                        }
                      : undefined
                  }
                >
                  <h3>{plan.name}</h3>
                  <p className={styles.muted}>{plan.people}</p>
                  <p style={{ fontWeight: 800 }}>{plan.price}</p>
                  <ul className={styles.list}>
                    {plan.includes.map((item) => (
                      <li key={item}>
                        <span className={styles.dot} />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.actions}>
                    <Link href={plan.cta.includes("Sales") ? "/contact" : "/signup"} className={`${styles.btn} ${styles.btnPrimary}`}>
                      {plan.cta}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <PricingEstimator />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Comparison</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Capability depth at a glance.
            </h2>
            <div className={styles.tableWrap} style={{ marginTop: "1rem" }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {comparisonHeaders.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((col) => (
                        <td key={col}>{col}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
  );
}
