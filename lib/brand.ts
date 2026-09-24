// Customer-facing product branding for the authenticated application.
//
// UMORA is the product name customers see on the public site, the login screen
// and inside the software. VYRON CORE remains the internal/technical platform
// name — database objects, API routes, storage keys, cookies, env vars, the
// Capacitor app id and `vyron-*` CSS class names are NOT renamed, and nothing
// here should be used to derive a technical identifier. VYRONSOFT remains the
// legal/company identity.
//
// The public marketing site reads the same values from lib/marketing/umora.ts;
// this module re-exports them so the two surfaces cannot drift apart.

import { brand as marketingBrand, SALES_EMAIL } from "@/lib/marketing/umora";

export const productBrand = {
  name: marketingBrand.name,
  mark: marketingBrand.mark,
  category: marketingBrand.category,
  company: marketingBrand.parent,
  pillars: marketingBrand.pillars,
  signature: "People Build Brighter Futures",
  /** Short line used under page titles inside the application. */
  appTagline: "Turn everyday workforce data into clearer decisions.",
  /** Metadata title/description for authenticated and auth routes. */
  appTitle: `${marketingBrand.name} — ${marketingBrand.category}`,
  appDescription:
    "UMORA connects people, attendance, rostering, HR operations, payroll readiness and workforce intelligence in one intelligent platform.",
  workspaceFallback: `${marketingBrand.name} Workspace`,
  /** Sign-off appended to employee-facing messages prepared by the application. */
  messageSignoff: marketingBrand.name,
  supportEmail: SALES_EMAIL,
} as const;
