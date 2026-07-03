"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import styles from "@/components/marketing/marketing.module.css";

const INVITE_PARAM = "invite";

export default function SignupPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const hasInvite = searchParams.has(INVITE_PARAM) || searchParams.has("token");
    if (!hasInvite) return;

    const query = searchParams.toString();
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const nextUrl = query ? `/login?${query}${hash}` : `/login${hash}`;
    window.location.replace(nextUrl);
  }, [searchParams]);

  return (
    <main>
        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.hero}>
              <span className={styles.kicker}>Start Free Trial</span>
              <h1 className={styles.h1}>Professional onboarding starts here.</h1>
              <p className={styles.lead}>
                Create your VYRON CORE workspace with guided setup for workforce structure, attendance policy, and
                payroll readiness workflows.
              </p>

              <div className={`${styles.grid} ${styles.grid3}`} style={{ marginTop: "1.2rem" }}>
                <article className={styles.card}>
                  <h3>Step 1</h3>
                  <p className={styles.muted}>Secure login and account verification.</p>
                </article>
                <article className={styles.card}>
                  <h3>Step 2</h3>
                  <p className={styles.muted}>Workforce structure and branch setup.</p>
                </article>
                <article className={styles.card}>
                  <h3>Step 3</h3>
                  <p className={styles.muted}>Clocking, leave, HR, and payroll readiness activation.</p>
                </article>
              </div>

              <div className={styles.actions}>
                <Link href="/login" className={`${styles.btn} ${styles.btnPrimary}`}>
                  Continue to secure signup
                </Link>
                <Link href="/contact" className={`${styles.btn} ${styles.btnSecondary}`}>
                  Book onboarding call
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
  );
}
