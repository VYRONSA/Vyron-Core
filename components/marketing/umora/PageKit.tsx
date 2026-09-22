// Building blocks for UMORA public marketing subpages. They reuse the landing
// page's visual language (dark photographic hero band, warm-white operational
// sections, Montserrat display type, mint / gold accents) so every public
// page reads as part of the same site as "/".

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { UmoraImage } from "@/lib/marketing/umora-media";
import { links } from "@/lib/marketing/umora";
import { Photo } from "./visuals";
import s from "./umora.module.css";
import p from "./pages.module.css";

export { p as pageStyles };

type HeroProps = {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Show the standard Book a Demo / secondary pair. */
  ctas?: { secondary?: { href: string; label: string } } | false;
  image?: UmoraImage;
  aside?: React.ReactNode;
  compact?: boolean;
};

export function PageHero({ eyebrow, title, lead, ctas = {}, image, aside, compact }: HeroProps) {
  const hasVisual = Boolean(image || aside);
  return (
    <section className={`${p.hero} ${compact ? p.heroCompact : ""}`} aria-labelledby="page-title">
      <div className={s.heroBackdrop} aria-hidden="true" />
      <div className={`${s.container} ${p.heroGrid} ${hasVisual ? p.heroGridSplit : ""}`}>
        <div className={p.heroCopy}>
          <p className={p.heroEyebrow}>{eyebrow}</p>
          <h1 id="page-title" className={p.heroTitle}>
            {title}
          </h1>
          {lead ? <p className={p.heroLead}>{lead}</p> : null}
          {ctas ? (
            <div className={p.heroCtas}>
              <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
                Book a Demo <ArrowRight />
              </Link>
              {ctas.secondary ? (
                <Link href={ctas.secondary.href} className={`${s.btn} ${s.btnOutline}`}>
                  {ctas.secondary.label}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        {image ? (
          <div className={p.heroPhoto}>
            <Photo image={image} priority sizes="(max-width: 1024px) 100vw, 45vw" />
          </div>
        ) : null}
        {aside ? <div className={p.heroAside}>{aside}</div> : null}
      </div>
    </section>
  );
}

type SectionProps = {
  tone?: "light" | "white" | "dark";
  id?: string;
  label?: string;
  children: React.ReactNode;
};

export function Section({ tone = "light", id, label, children }: SectionProps) {
  const toneClass = tone === "dark" ? p.dark : tone === "white" ? p.white : p.light;
  return (
    <section id={id} className={`${p.section} ${toneClass}`} aria-label={label}>
      <div className={s.container}>{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lead,
  light = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div className={p.head}>
      {eyebrow ? <p className={s.eyebrow}>{eyebrow}</p> : null}
      <h2 className={`${p.headTitle} ${light ? p.headTitleLight : ""}`}>{title}</h2>
      {lead ? <p className={`${p.headLead} ${light ? p.headLeadLight : ""}`}>{lead}</p> : null}
    </div>
  );
}

/** Page wrapper: gives subpages the UMORA tokens and header behaviour. */
export function UmoraPage({ children }: { children: React.ReactNode }) {
  return <main className={`${s.page} ${p.subpage}`}>{children}</main>;
}
