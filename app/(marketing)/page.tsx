import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/marketing/JsonLd";
import PricingEstimator from "@/components/marketing/PricingEstimator";
import styles from "@/components/marketing/marketing.module.css";
import {
  buildPageMetadata,
  comparisonHeaders,
  comparisonRows,
  coreFeatures,
  faqs,
  featureMatrix,
  industries,
  outcomes,
  plans,
  showcaseModules,
  siteDescription,
  siteName,
  siteUrl,
} from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "VYRON CORE | Stop Payroll Leakage Before Payroll Happens",
  description: siteDescription,
  path: "/",
});

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: siteName,
  url: siteUrl,
  description: siteDescription,
  areaServed: "South Africa",
  sameAs: ["https://www.linkedin.com"],
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteName,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  offers: plans.map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    description: `${plan.people} - ${plan.price}`,
  })),
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.a,
    },
  })),
};

export default function LandingPage() {
  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={softwareSchema} />
      <JsonLd data={faqSchema} />

      <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.hero}>
              <div className={styles.heroGrid}>
                <div>
                  <span className={styles.kicker}>AI Workforce Intelligence Platform</span>
                  <h1 className={styles.h1}>Stop Payroll Leakage Before Payroll Happens</h1>
                  <p className={styles.lead}>
                    VYRON CORE is South Africa&apos;s AI Workforce Intelligence Platform that helps businesses manage
                    employees, attendance, HR operations, compliance and payroll readiness from one intelligent platform.
                  </p>
                  <div className={styles.actions}>
                    <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                      Book a Demo
                    </Link>
                    <Link href="/signup" className={`${styles.btn} ${styles.btnSecondary}`}>
                      Start Free Trial
                    </Link>
                  </div>
                </div>

                <div className={styles.heroPanel} aria-label="Animated dashboard preview">
                  <div className={styles.heroPulse} />
                  <div className={styles.heroBars}>
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <span key={`bar-${idx}`} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Trusted By</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Built for South African Businesses.
            </h2>
            <div className={`${styles.grid} ${styles.grid4}`} style={{ marginTop: "1.2rem" }}>
              {[
                "Multi-branch retailers",
                "Hospitality groups",
                "Field service operators",
                "High-compliance employers",
              ].map((trust) => (
                <div key={trust} className={styles.card}>
                  <h3>{trust}</h3>
                  <p className={styles.muted}>Operational teams that need workforce certainty before payroll close.</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Industries</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Industry-ready workforce control.
            </h2>
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
                      Learn more
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Why VYRON CORE</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              One platform for workforce execution and intelligence.
            </h2>
            <div className={`${styles.grid} ${styles.grid4}`} style={{ marginTop: "1.2rem" }}>
              {coreFeatures.map((feature) => (
                <div key={feature} className={styles.card}>
                  <h3>{feature}</h3>
                  <p className={styles.muted}>
                    Enterprise-grade workflows built for daily workforce control and operational decision speed.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Platform Showcase</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Real application modules across the VYRON CORE platform.
            </h2>
            <p className={styles.lead}>
              Showcase links point to live product modules and authenticated routes. No simulated or fake dashboard imagery
              is used.
            </p>
            <div className={`${styles.grid} ${styles.grid4}`} style={{ marginTop: "1.2rem" }}>
              {showcaseModules.map((module) => (
                <article key={module.name} className={styles.card}>
                  <h3>{module.name}</h3>
                  <p className={styles.muted}>{module.description}</p>
                  <div className={styles.actions}>
                    <Link href="/login" className={`${styles.btn} ${styles.btnPrimary}`}>
                      Open secure preview
                    </Link>
                    <Link href={module.route} className={`${styles.btn} ${styles.btnSecondary}`}>
                      Module route
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Feature Matrix</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Full platform capability map.
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
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Business Outcomes</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Shift from manual operations to measurable control.
            </h2>
            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {outcomes.map((row) => (
                <div key={row.before} className={styles.card}>
                  <p style={{ margin: 0, fontSize: "0.8rem", textTransform: "uppercase", color: "#8b98aa" }}>Before</p>
                  <h3 style={{ marginTop: "0.4rem" }}>{row.before}</h3>
                  <p style={{ margin: "0.8rem 0 0", fontSize: "0.8rem", textTransform: "uppercase", color: "#1c4a9a" }}>
                    After
                  </p>
                  <h4 style={{ marginTop: "0.4rem", fontSize: "1.2rem" }}>{row.after}</h4>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Pricing</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Packages for growth from 20 to enterprise scale.
            </h2>
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
                  <p className={styles.muted} style={{ marginTop: "0.2rem" }}>
                    {plan.people}
                  </p>
                  <p style={{ fontWeight: 800, marginTop: "0.45rem" }}>{plan.price}</p>
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

            <div style={{ marginTop: "1rem" }}>
              <PricingEstimator />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Comparison</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Why teams move from legacy tools to VYRON CORE.
            </h2>
            <div className={styles.tableWrap} style={{ marginTop: "1.2rem" }}>
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

        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Frequently Asked Questions</span>
            <h2 className={styles.h1} style={{ fontSize: "clamp(1.7rem, 4vw, 2.7rem)" }}>
              Everything decision-makers ask before rollout.
            </h2>
            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              {faqs.map((faq) => (
                <details key={faq.q} className={styles.faq}>
                  <summary>{faq.q}</summary>
                  <p>{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.hero}>
              <span className={styles.kicker}>Final Call To Action</span>
              <h2 className={styles.h1}>Ready to Take Control of Your Workforce?</h2>
              <p className={styles.lead}>
                See how VYRON CORE drives attendance integrity, payroll readiness, and compliance certainty in your
                operation.
              </p>
              <div className={styles.actions}>
                <Link href="/contact" className={`${styles.btn} ${styles.btnPrimary}`}>
                  Book Demo
                </Link>
                <Link href="/signup" className={`${styles.btn} ${styles.btnSecondary}`}>
                  Start Free Trial
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
