import Link from "next/link";
import { ArrowRight } from "lucide-react";
import MobileMenu from "@/components/marketing/umora/MobileMenu";
import { Photo, Swoosh, UmoraLogo } from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { footerItems, navItems } from "@/lib/marketing/site";
import { brand, ecosystem, links, vyronsoft } from "@/lib/marketing/umora";
import { ctaJourney } from "@/lib/marketing/umora-media";
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
            <UmoraLogo />
          </Link>

          <nav className={s.shellNav} aria-label="Primary">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={s.shellCtas}>
            <Link href={links.login} className={`${s.btn} ${s.btnLogin}`}>
              Login
            </Link>
            <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
              Book a Demo <ArrowRight />
            </Link>
          </div>

          <MobileMenu />
        </div>
      </header>

      {children}

      <footer className={s.shell}>
        <section className={s.cta} aria-labelledby="cta-title">
          <div className={s.ctaPhoto}>
            <Photo image={ctaJourney} sizes="(max-width: 1024px) 100vw, 45vw" />
          </div>
          <div className={`${s.container} ${s.ctaGrid}`}>
            <div className={s.ctaBrand}>
              <UmoraLogo size="lg" />
              <p>A {brand.parent} product</p>
            </div>
            <div className={s.ctaCopy}>
              <h2 id="cta-title">
                <span>Your people are already generating data.</span>
                <span className={s.mint}>UMORA turns it into intelligence.</span>
              </h2>
              <p>
                See how UMORA connects attendance, people, rostering, HR operations and payroll readiness in one
                intelligent workforce platform.
              </p>
              <div className={s.ctaBtns}>
                <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
                  Book a Demo <ArrowRight />
                </Link>
                <Link href={links.start} className={`${s.btn} ${s.btnTeal}`}>
                  Start Your Journey
                </Link>
              </div>
            </div>
            <div className={s.ctaArt} aria-hidden="true">
              <p className={s.ctaScript}>
                <span>People</span>
                <span>Build</span>
                <span>Brighter</span>
                <span>Futures</span>
              </p>
              <Swoosh className={s.ctaSwoosh} />
            </div>
            <ul className={s.ctaPillars} aria-label="UMORA pillars">
              {brand.pillars.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className={s.footEco} aria-labelledby="ecosystem-title">
          <div className={`${s.container} ${s.footEcoGrid}`}>
            <div className={s.footCorp}>
              <a href={vyronsoft.url} className={s.footCorpName}>
                {vyronsoft.legalName}
              </a>
              <p>{vyronsoft.statement}</p>
            </div>
            <div>
              <h2 id="ecosystem-title" className={s.footEcoTitle}>
                VYRONSOFT Software Ecosystem
              </h2>
              <ul className={s.footEcoList}>
                {ecosystem.map((product) => (
                  <li key={product.url}>
                    <a href={product.url}>{product.name}</a>
                    <span>{product.descriptor}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className={s.footBar}>
          <div className={`${s.container} ${s.footRow}`}>
            <nav className={s.footNav} aria-label="Footer">
              {footerItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <nav className={s.footLegal} aria-label="Legal">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <span className={s.copy}>
                © {new Date().getFullYear()} {vyronsoft.legalName}. All rights reserved.
              </span>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
