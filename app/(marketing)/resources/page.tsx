import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata, resources } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Resources | VYRON CORE",
  description: "Guides, articles, and operational playbooks for workforce intelligence, HR governance, and payroll readiness.",
  path: "/resources",
});

export default function ResourcesPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Resources</span>
            <h1 className={styles.h1}>Guides, articles, and implementation playbooks.</h1>
            <p className={styles.lead}>
              This architecture is ready for content scaling, thought leadership publishing, and demand generation.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {resources.map((resource) => (
                <article key={resource.title} className={styles.card}>
                  <p style={{ margin: 0, fontSize: "0.8rem", textTransform: "uppercase", color: "#3d6cb0" }}>
                    {resource.category}
                  </p>
                  <h3 style={{ marginTop: "0.4rem" }}>{resource.title}</h3>
                  <p className={styles.muted}>{resource.summary}</p>
                  <div className={styles.actions}>
                    <Link href="/contact" className={`${styles.btn} ${styles.btnSecondary}`}>
                      Request resource
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
