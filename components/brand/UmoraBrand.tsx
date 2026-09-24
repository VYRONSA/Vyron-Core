// UMORA brand primitives for the authenticated application and auth screens.
// Drawn to the same geometry as the public site's mark
// (components/marketing/umora/visuals.tsx) so the two surfaces read as one
// product. Kept separate from the marketing module so the app bundle does not
// pull in the landing-page CSS module.

import { useId } from "react";
import { productBrand } from "@/lib/brand";

export function UmoraMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  // Gradient ids must be unique per instance: the mark renders in the sidebar,
  // the mobile header and the login panel at the same time.
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={`block shrink-0 ${className}`}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ef0c7" />
          <stop offset="1" stopColor="#1fb28a" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ec5a8" />
          <stop offset="1" stopColor="#0f7f6c" />
        </linearGradient>
      </defs>
      <path d="M3 5.5a2.5 2.5 0 0 1 2.5-2.5h5a2.5 2.5 0 0 1 2.5 2.5V29H5.5A2.5 2.5 0 0 1 3 26.5Z" fill={`url(#${id}a)`} />
      <path d="M15 8.5 25.6 3.4A2.5 2.5 0 0 1 29 5.7v20.8a2.5 2.5 0 0 1-2.5 2.5H15Z" fill={`url(#${id}b)`} />
    </svg>
  );
}

/** Mark + UMORA™ wordmark + category line, as in the sidebar and login panel. */
export function UmoraLogo({
  size = "md",
  showCategory = true,
  tone = "onDark",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  showCategory?: boolean;
  /** onDark: white wordmark (sidebar, login panel). onLight: navy wordmark on white cards. */
  tone?: "onDark" | "onLight";
  className?: string;
}) {
  const mark = size === "lg" ? 52 : size === "md" ? 44 : 30;
  const word = size === "lg" ? "text-[2.6rem]" : size === "md" ? "text-[2.1rem]" : "text-[1.45rem]";
  const sub =
    size === "sm" ? "text-[0.5rem] tracking-[0.16em]" : size === "md" ? "text-[0.54rem] tracking-[0.13em]" : "text-[0.66rem] tracking-[0.22em]";
  return (
    <div className={`flex items-center gap-3 ${tone === "onDark" ? "text-white" : "text-[#0f1d33]"} ${className}`}>
      <UmoraMark size={mark} />
      <div className="min-w-0">
        <div className={`umora-sans ${word} font-semibold leading-none tracking-[0.04em]`}>
          {productBrand.name}
          <sup className="ml-0.5 align-super text-[0.4em] font-semibold">™</sup>
        </div>
        {showCategory && (
          <div className={`umora-sans mt-1.5 ${sub} whitespace-nowrap font-semibold uppercase ${tone === "onDark" ? "text-white/90" : "text-emerald-700"}`}>
            {productBrand.category}
          </div>
        )}
      </div>
    </div>
  );
}

/** "PEOPLE | TIME | WORK | INTELLIGENCE" — the brand pillar line. */
export function UmoraPillars({ className = "", rule = false }: { className?: string; rule?: boolean }) {
  return (
    <div className={`umora-sans flex items-center gap-4 text-[0.68rem] font-semibold uppercase tracking-[0.34em] ${className}`}>
      {rule && <span className="h-[3px] w-12 shrink-0 rounded-full bg-[#f2c14e]" aria-hidden="true" />}
      <span>{productBrand.pillars.join("  |  ")}</span>
    </div>
  );
}

/** Hand-lettered "People Build Brighter Futures" with its swoosh underline. */
export function UmoraSignature({ className = "" }: { className?: string }) {
  const words = productBrand.signature.split(" ");
  return (
    <div className={`umora-script pointer-events-none select-none text-[#4fe3a1] ${className}`} aria-hidden="true">
      <div className="-rotate-[14deg] leading-[0.95]">
        {words.map((word, index) => (
          <div key={word} style={{ paddingLeft: `${index * 0.55}em` }}>
            {word}
          </div>
        ))}
        <svg viewBox="0 0 200 40" className="mt-1 h-[0.7em] w-[5.4em]" preserveAspectRatio="none">
          <path d="M4 34 C 60 26, 120 16, 196 4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/** Footer line: "A VYRONSOFT PRODUCT". */
export function UmoraByline({ className = "" }: { className?: string }) {
  return (
    <div className={`umora-sans text-[0.62rem] font-semibold uppercase tracking-[0.32em] ${className}`}>
      A {productBrand.company} product
    </div>
  );
}
