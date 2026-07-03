import Link from "next/link";
import { navItems } from "@/lib/marketing/site";
import styles from "./marketing.module.css";

type MarketingShellProps = {
  children: React.ReactNode;
};

export default function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerRow}`}>
          <Link href="/" className={styles.brand} aria-label="VYRON CORE home">
            <span className={styles.brandMark} aria-hidden="true" />
            <span className={styles.brandText}>
              <strong>VYRON CORE</strong>
              <span>AI Workforce Intelligence</span>
            </span>
          </Link>

          <nav className={styles.nav} aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={styles.ctaStack}>
            <Link href="/login" className={`${styles.btn} ${styles.btnSecondary}`}>
              Login
            </Link>
            <Link href="/signup" className={`${styles.btn} ${styles.btnPrimary}`}>
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div className={styles.footerCol}>
            <h4>VYRON CORE</h4>
            <p className={styles.small}>
              Workforce intelligence for South African businesses that need payroll readiness, compliance,
              and operational control.
            </p>
            <p className={styles.small}>Built for South African Businesses.</p>
          </div>

          <div className={styles.footerCol}>
            <h4>Company</h4>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/resources">Resources</Link>
            <Link href="/pricing">Pricing</Link>
          </div>

          <div className={styles.footerCol}>
            <h4>Products</h4>
            <Link href="/features">Features</Link>
            <Link href="/industries">Industries</Link>
            <Link href="/solutions">Solutions</Link>
            <Link href="/login">Support</Link>
          </div>

          <div className={styles.footerCol}>
            <h4>Legal</h4>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms</Link>
            <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">
              LinkedIn
            </a>
            <Link href="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
