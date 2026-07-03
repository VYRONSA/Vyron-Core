import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata, industries } from "@/lib/marketing/site";

type IndustryPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return industries.map((industry) => ({ slug: industry.slug }));
}

export async function generateMetadata({ params }: IndustryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const industry = industries.find((item) => item.slug === slug);
  if (!industry) {
    return buildPageMetadata({
      title: "Industry | VYRON CORE",
      description: "Industry-specific workforce intelligence workflows.",
      path: `/industries/${slug}`,
    });
  }

  return buildPageMetadata({
    title: `${industry.name} Workforce Intelligence | VYRON CORE`,
    description: industry.detail,
    path: `/industries/${industry.slug}`,
  });
}

export default async function IndustryDetailPage({ params }: IndustryPageProps) {
  const { slug } = await params;
  const industry = industries.find((item) => item.slug === slug);

  if (!industry) {
    notFound();
  }

  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Industry Solution</span>
            <h1 className={styles.h1}>{industry.name}</h1>
            <p className={styles.lead}>{industry.detail}</p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              <article className={styles.card}>
                <h3>Operational challenge</h3>
                <p className={styles.muted}>{industry.challenge}</p>
              </article>
              <article className={styles.card}>
                <h3>Target outcome</h3>
                <p className={styles.muted}>{industry.outcome}</p>
              </article>
              <article className={styles.card}>
                <h3>Why VYRON CORE</h3>
                <p className={styles.muted}>
                  Unified attendance, HR, compliance, and payroll readiness workflows with management accountability.
                </p>
              </article>
            </div>

            <div className={styles.actions}>
              <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                Book a demo for {industry.name}
              </Link>
              <Link href="/industries" className={`${styles.btn} ${styles.btnSecondary}`}>
                Back to industries
              </Link>
            </div>
          </div>
        </section>
      </main>
  );
}
