"use client";

import Link from "next/link";

const CORE_PACKAGES = [
  {
    name: "Starter",
    price: "R1,499",
    period: "/ month",
    employees: "Up to 25 employees",
    users: "2 system users",
    highlights: ["HR & employee records", "Clocking & leave", "Payroll readiness", "Command Centre"],
    cta: "Book a demo",
    featured: false,
  },
  {
    name: "Professional",
    price: "R4,999",
    period: "/ month",
    employees: "Up to 100 employees",
    users: "Unlimited system users",
    highlights: [
      "Everything in Starter",
      "Field Operations",
      "Travel & cost intelligence",
      "Reports Centre",
    ],
    cta: "Book a demo",
    featured: true,
  },
  {
    name: "Business",
    price: "R7,500",
    period: "/ month",
    employees: "Up to 250 employees",
    users: "20 system users",
    highlights: [
      "Everything in Professional",
      "Vehicle & asset intelligence",
      "Profitability intelligence",
      "Client portal",
    ],
    cta: "Book a demo",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "Contact Sales",
    period: "",
    employees: "Unlimited scale",
    users: "Custom seats",
    highlights: [
      "Multi-company rollout",
      "Dedicated onboarding",
      "Custom integrations",
      "Priority support",
    ],
    cta: "Contact sales",
    featured: false,
  },
] as const;

export default function PricingPackagingConsole() {
  return (
    <section className="rounded-[34px] border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.13)] backdrop-blur-xl">
      <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">
        VYRON CORE V2
      </div>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
        Pricing &amp; packages
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
        Transparent monthly pricing in ZAR. All plans include secure multi-tenant hosting, role-based
        access, and ongoing platform updates.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {CORE_PACKAGES.map((pkg) => (
          <article
            key={pkg.name}
            className={`rounded-[28px] border p-5 shadow-sm ${
              pkg.featured
                ? "border-cyan-300 bg-gradient-to-br from-cyan-50 to-white ring-2 ring-cyan-200"
                : "border-slate-200 bg-white"
            }`}
          >
            {pkg.featured && (
              <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-cyan-700">
                Most popular
              </div>
            )}
            <h3 className="text-xl font-black text-slate-950">{pkg.name}</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-black text-slate-950">{pkg.price}</span>
              {pkg.period && (
                <span className="text-sm font-semibold text-slate-500">{pkg.period}</span>
              )}
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-600">{pkg.employees}</p>
            <p className="text-xs text-slate-500">{pkg.users}</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {pkg.highlights.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-cyan-600">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/contact"
              className={`mt-5 inline-flex w-full justify-center rounded-2xl px-4 py-3 text-sm font-black ${
                pkg.featured
                  ? "bg-[#06101f] text-cyan-300"
                  : "border border-slate-200 bg-slate-50 text-slate-900"
              }`}
            >
              {pkg.cta}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
