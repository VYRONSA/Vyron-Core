import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Solutions | VYRON CORE",
  description: "Enterprise SaaS solutions for HR operations, attendance integrity, payroll readiness, and workforce intelligence.",
  path: "/solutions",
});

const solutionCards = [
  {
    title: "Payroll Leakage Prevention",
    text: "Detect missing, late, and irregular attendance patterns before payroll finalization.",
  },
  {
    title: "Manager Action Centre",
    text: "Turn unresolved workforce events into accountable manager workflows.",
  },
  {
    title: "Compliance Command",
    text: "Centralize HR cases, warnings, and documentation for audit confidence.",
  },
  {
    title: "Mobile Workforce Execution",
    text: "Enable employee and manager action flows across branch and field operations.",
  },
  {
    title: "Operational Intelligence",
    text: "Combine workforce analytics and AI insight to prioritize what matters now.",
  },
  {
    title: "Enterprise Rollout",
    text: "Deploy by branch, region, or business unit with structured governance support.",
  },
];

export default function SolutionsPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Solutions</span>
            <h1 className={styles.h1}>Use-case specific execution for enterprise teams.</h1>
            <p className={styles.lead}>
              VYRON CORE supports operational, HR, and payroll outcomes from one unified workflow engine.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {solutionCards.map((card) => (
                <article key={card.title} className={styles.card}>
                  <h3>{card.title}</h3>
                  <p className={styles.muted}>{card.text}</p>
                </article>
              ))}
            </div>

            <div className={styles.actions}>
              <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                Book Solution Demo
              </Link>
              <Link href="/features" className={`${styles.btn} ${styles.btnSecondary}`}>
                Explore Features
              </Link>
            </div>
          </div>
        </section>
      </main>
  );
}
