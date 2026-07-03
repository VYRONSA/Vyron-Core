import type { Metadata } from "next";
import ContactForm from "@/components/marketing/ContactForm";
import styles from "@/components/marketing/marketing.module.css";
import { buildPageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = buildPageMetadata({
  title: "Contact | VYRON CORE",
  description: "Book a VYRON CORE demo and discuss rollout plans for your workforce operation.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <span className={styles.kicker}>Contact</span>
            <h1 className={styles.h1}>Book a professional workforce intelligence demo.</h1>
            <p className={styles.lead}>
              Tell us about your operation and team size. We will align a rollout path for your business model.
            </p>

            <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
              <ContactForm />

              <article className={styles.card}>
                <h3>Direct channels</h3>
                <p className={styles.muted}>Sales and implementation team support for South African operations.</p>
                <ul className={styles.list}>
                  <li>
                    <span className={styles.dot} />
                    Email: info@vyronsoft.co.za
                  </li>
                  <li>
                    <span className={styles.dot} />
                    Demo bookings: Monday to Friday
                  </li>
                  <li>
                    <span className={styles.dot} />
                    Coverage: National workforce deployments
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>
      </main>
  );
}
