import Link from "next/link";
import { ArrowRight } from "lucide-react";
import MobileMenu from "@/components/marketing/umora/MobileMenu";
import { UmoraMark } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { navItems } from "@/lib/marketing/site";
import { brand, links } from "@/lib/marketing/umora";
import styles from "./marketing.module.css";

type MarketingShellProps = {
  children: React.ReactNode;
};

export default function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className={styles.root}>
      <header className={`${s.shell} ${s.shellHeader}`}>
        <div className={`${s.container} ${s.shellRow}`}>
          <Link href="/" className={s.shellBrand} aria-label={`${brand.name} home`}>
            <UmoraMark size={30} />
            <span className={s.shellBrandText}>
              <strong>{brand.name}</strong>
              <span>{brand.category}</span>
            </span>
          </Link>

          <nav className={s.shellNav} aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={s.shellCtas}>
            <Link href={links.login} className={`${s.btn} ${s.shellLogin}`}>
              Login
            </Link>
            <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
              Book a demo <ArrowRight size={15} />
            </Link>
          </div>

          <MobileMenu />
        </div>
      </header>

      {children}

      <footer className={`${s.shell} ${s.shellFooter}`}>
        <div className={s.container}>
          <div className={s.shellFooterTop}>
            <div className={s.shellFooterBrand}>
              <Link href="/" className={s.shellBrand} aria-label={`${brand.name} home`}>
                <UmoraMark size={34} />
                <span className={s.shellBrandText}>
                  <strong>{brand.mark}</strong>
                  <span>{brand.category}</span>
                </span>
              </Link>
              <p className={s.shellFooterTagline}>&ldquo;{brand.tagline}&rdquo;</p>
              <p className={s.shellFooterParent}>A {brand.parent} product</p>
            </div>

            <div className={s.shellFooterCol}>
              <h4>Platform</h4>
              <Link href="/features">Features</Link>
              <Link href="/solutions">Solutions</Link>
              <Link href="/industries">Industries</Link>
              <Link href="/pricing">Pricing</Link>
            </div>

            <div className={s.shellFooterCol}>
              <h4>Company</h4>
              <Link href="/about">About</Link>
              <Link href="/resources">Resources</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/login">Support</Link>
            </div>

            <div className={s.shellFooterCol}>
              <h4>Legal</h4>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms</Link>
              <a href="https://www.linkedin.com" target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </div>
          </div>

          <div className={s.shellFooterBottom}>
            <span>
              © {new Date().getFullYear()} {brand.parent}. All rights reserved.
            </span>
            <span className={s.shellFooterPillars}>{brand.pillars.join(" · ")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
