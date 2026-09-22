import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  CalendarRange,
  ChefHat,
  Clock,
  ClipboardCheck,
  Eye,
  Factory,
  FileText,
  FolderCheck,
  Gavel,
  HardHat,
  History,
  Hotel,
  ListChecks,
  MapPin,
  Pickaxe,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Store,
  Timer,
  Truck,
  UserRound,
  Users,
  Wallet,
  Wheat,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import JsonLd from "@/components/marketing/JsonLd";
import {
  ActionCentre,
  ClockingPhone,
  DemoBadge,
  HeroDashboard,
  InsightCard,
  MobilePair,
  PayrollReadiness,
  RosterBoard,
  SiteMap,
  UmoraMark,
} from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { faqs, industries, plans, siteUrl } from "@/lib/marketing/site";
import { brand, demoKpis, links, seo } from "@/lib/marketing/umora";

export const metadata: Metadata = {
  title: { absolute: seo.title },
  description: seo.description,
  alternates: { canonical: `${siteUrl}/` },
  openGraph: {
    title: seo.title,
    description: seo.description,
    type: "website",
    url: `${siteUrl}/`,
    siteName: brand.name,
  },
  twitter: {
    card: "summary_large_image",
    title: seo.title,
    description: seo.description,
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: brand.parent,
  url: siteUrl,
  brand: { "@type": "Brand", name: brand.name, slogan: brand.tagline },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: brand.name,
  description: seo.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, Android",
  publisher: { "@type": "Organization", name: brand.parent },
  offers: plans.map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    description: `${plan.people} - ${plan.price}`,
  })),
};

const landingFaqs = faqs.slice(0, 8);

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: landingFaqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

const heroValues: { icon: LucideIcon; label: string }[] = [
  { icon: Wallet, label: "Control payroll leakage" },
  { icon: Eye, label: "Real-time visibility" },
  { icon: ShieldCheck, label: "Simpler compliance" },
  { icon: ListChecks, label: "Manager accountability" },
];

const heroFlow = ["People", "Time", "Attendance", "Rosters", "Operations", "Payroll readiness", "Intelligence"];

const questions = [
  { q: "Who", a: "is working", module: "Employee records" },
  { q: "Where", a: "they are working", module: "GPS-verified clocking" },
  { q: "When", a: "they should be working", module: "Rostering" },
  { q: "What", a: "happened during the shift", module: "Attendance timeline" },
  { q: "Why", a: "an exception occurred", module: "Exception triggers" },
  { q: "How", a: "it affects payroll", module: "Payroll readiness" },
  { q: "Next", a: "what the manager needs to do", module: "Manager Action Centre" },
];

const platform: { icon: LucideIcon; name: string; text: string }[] = [
  { icon: Users, name: "People", text: "Digital employee records with branch and role context, from onboarding through the full lifecycle." },
  { icon: Clock, name: "Clocking", text: "GPS-verified clock-in and clock-out with live photo verification and exception triggers." },
  { icon: CalendarDays, name: "Rostering", text: "Plan shifts, see coverage and align people with operational demand across sites." },
  { icon: CalendarRange, name: "Leave", text: "Digital leave requests and approvals with policy-aware visibility and a decision audit." },
  { icon: ListChecks, name: "Manager Actions", text: "One prioritised queue to review, resolve and close workforce exceptions every day." },
  { icon: Briefcase, name: "HR Operations", text: "HR case management, workflow routing and a disciplinary warning register." },
  { icon: FileText, name: "Documents", text: "A central employee document vault for HR and compliance records." },
  { icon: ShieldCheck, name: "Compliance", text: "Policy tracking, owned escalations and audit-ready historical records." },
  { icon: Wallet, name: "Payroll Readiness", text: "Daily payroll risk monitoring and overtime visibility before export." },
  { icon: Sparkles, name: "Intelligence", text: "Workforce trends, KPIs and pattern detection that surface risk before payroll close." },
];

const clockChain: { icon: LucideIcon; name: string; text: string }[] = [
  { icon: MapPin, name: "Attendance", text: "Captured on site and verified by GPS and photo" },
  { icon: CalendarDays, name: "Shift", text: "Matched to the roster it belongs to" },
  { icon: Timer, name: "Overtime", text: "Hours beyond the shift flagged as they happen" },
  { icon: Wallet, name: "Payroll", text: "Clean, verified hours ready for processing" },
  { icon: Sparkles, name: "Insight", text: "Patterns turned into workforce intelligence" },
];

const hrFlow: { icon: LucideIcon; name: string }[] = [
  { icon: UserRound, name: "Employee" },
  { icon: FolderCheck, name: "Case" },
  { icon: Gavel, name: "Warning" },
  { icon: FileText, name: "Document" },
  { icon: Users, name: "Manager" },
  { icon: ClipboardCheck, name: "Resolution" },
  { icon: History, name: "History" },
];

const industryIcons: Record<string, LucideIcon> = {
  retail: Store,
  hospitality: Hotel,
  restaurants: ChefHat,
  manufacturing: Factory,
  logistics: Truck,
  security: Shield,
  cleaning: SprayCan,
  construction: HardHat,
  "mining-contractors": Pickaxe,
  agriculture: Wheat,
  "field-service": Wrench,
};

// Emerald, champagne and slate-blue accents only — no rainbow of hues.
const industryHues = ["160", "40", "210"];

const transformation = [
  "People",
  "Time",
  "Attendance",
  "Roster",
  "Exceptions",
  "Manager action",
  "Payroll readiness",
  "Intelligence",
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className={s.eyebrow}>{children}</span>;
}

export default function LandingPage() {
  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={softwareSchema} />
      <JsonLd data={faqSchema} />

      <main className={s.page}>
        {/* HERO */}
        <section className={`${s.section} ${s.hero}`} aria-labelledby="hero-title">
          <div className={s.heroGlow} aria-hidden="true" />
          <div className={`${s.container} ${s.heroGrid}`}>
            <div className={s.heroCopy}>
              <Eyebrow>{brand.category}</Eyebrow>
              <h1 id="hero-title" className={s.display}>
                Your people are your business.
                <span className={s.displayAccent}>Make them visible.</span>
              </h1>
              <p className={s.lead}>{brand.positioning}</p>
              <div className={s.ctaRow}>
                <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
                  Book a demo <ArrowRight size={17} />
                </Link>
                <a href={links.explore} className={`${s.btn} ${s.btnGhost}`}>
                  Explore UMORA <Play size={14} />
                </a>
              </div>
              <ul className={s.heroValues}>
                {heroValues.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <Icon size={18} strokeWidth={1.7} />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={s.heroVisual}>
              <p className={s.script} aria-hidden="true">
                People · Time · Work · Intelligence
              </p>
              <HeroDashboard />
            </div>
          </div>

          <div className={s.container}>
            <ol className={s.flowStrip} aria-label="How UMORA connects the working day">
              {heroFlow.map((step, i) => (
                <li key={step} style={{ animationDelay: `${i * 90}ms` }}>
                  <span className={s.flowIndex}>{String(i + 1).padStart(2, "0")}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* THE PROBLEM */}
        <section className={`${s.section} ${s.light}`} aria-labelledby="problem-title">
          <div className={s.container}>
            <div className={s.split}>
              <div>
                <Eyebrow>The human side of business</Eyebrow>
                <h2 id="problem-title" className={s.h2}>
                  The human side of business <span className={s.emeraldText}>just became intelligent.</span>
                </h2>
              </div>
              <div>
                <p className={s.body}>
                  Every business depends on people. Yet the answers to the most basic workforce questions usually live in
                  different places — a clocking device, a spreadsheet roster, a leave form and a payroll file. UMORA
                  connects these answers.
                </p>
                <p className={s.script} aria-hidden="true">
                  Different people. Same purpose.
                </p>
              </div>
            </div>

            <ol className={s.questions}>
              {questions.map((item, i) => (
                <li key={item.q} className={s.question} style={{ animationDelay: `${i * 60}ms` }}>
                  <span className={s.questionWord}>{item.q}</span>
                  <span className={s.questionText}>{item.a}</span>
                  <span className={s.questionModule}>
                    <ArrowRight size={13} /> {item.module}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* WORKFORCE VISUAL */}
        <section className={`${s.section} ${s.dark}`} aria-labelledby="live-title">
          <div className={`${s.container} ${s.liveGrid}`}>
            <div>
              <Eyebrow>Multi-site workforce control</Eyebrow>
              <h2 id="live-title" className={s.h2}>
                See your workforce <span className={s.emeraldText}>as it happens.</span>
              </h2>
              <p className={s.body}>
                Live visibility across every site, team and shift — who is on site, who is late and where overtime is
                building, before it becomes a payroll problem.
              </p>
              <div className={s.kpiGrid}>
                {demoKpis.map((kpi) => (
                  <div key={kpi.label} className={s.kpi}>
                    <strong>{kpi.value}</strong>
                    <span>{kpi.label}</span>
                  </div>
                ))}
              </div>
              <DemoBadge />
            </div>
            <SiteMap />
          </div>
        </section>

        {/* PLATFORM */}
        <section id="platform" className={`${s.section} ${s.white}`} aria-labelledby="platform-title">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow>The platform</Eyebrow>
              <h2 id="platform-title" className={s.h2}>
                One workforce. <span className={s.emeraldText}>One intelligent platform.</span>
              </h2>
              <p className={s.body}>Everything you need to manage your people, time and operations — in one place.</p>
            </div>
            <div className={s.platformGrid}>
              {platform.map(({ icon: Icon, name, text }) => (
                <article key={name} className={s.platformCard}>
                  <span className={s.platformIcon}>
                    <Icon size={20} strokeWidth={1.8} />
                  </span>
                  <h3>{name}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
            <div className={s.centerRow}>
              <Link href="/features" className={`${s.btn} ${s.btnOutline}`}>
                Explore all features <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>

        {/* CLOCKING */}
        <section className={`${s.section} ${s.light}`} aria-labelledby="clock-title">
          <div className={`${s.container} ${s.clockGrid}`}>
            <div className={s.clockVisual}>
              <ClockingPhone />
            </div>
            <div>
              <Eyebrow>GPS &amp; photo clocking</Eyebrow>
              <h2 id="clock-title" className={s.h2}>
                Every clock&#8209;in <span className={s.emeraldText}>tells a story.</span>
              </h2>
              <p className={s.body}>
                Each clock event is verified by GPS and live photo, matched to the roster, and checked against exception
                triggers for late, missing and anomalous events — so it arrives at payroll already explained.
              </p>
              <ol className={s.chain}>
                {clockChain.map(({ icon: Icon, name, text }) => (
                  <li key={name}>
                    <span className={s.chainIcon}>
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <span>{text}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ROSTERING */}
        <section className={`${s.section} ${s.white}`} aria-labelledby="roster-title">
          <div className={`${s.container} ${s.split} ${s.splitCenter}`}>
            <div>
              <Eyebrow>Rostering</Eyebrow>
              <h2 id="roster-title" className={s.h2}>
                Put the right people <span className={s.emeraldText}>in the right place.</span>
              </h2>
              <p className={s.body}>
                Plan shifts against operational demand and see coverage before the week starts — understaffed windows
                and overtime risk show up on the roster, not on the payslip.
              </p>
              <ul className={s.ticks}>
                <li>Shift coverage by site and team</li>
                <li>Understaffed windows highlighted</li>
                <li>Overtime risk flagged before it is worked</li>
              </ul>
            </div>
            <RosterBoard />
          </div>
        </section>

        {/* MANAGER ACTION CENTRE */}
        <section className={`${s.section} ${s.dark} ${s.actionSection}`} aria-labelledby="action-title">
          <div className={`${s.container} ${s.split} ${s.splitCenter}`}>
            <div>
              <Eyebrow>Manager Action Centre</Eyebrow>
              <h2 id="action-title" className={s.h2}>
                Don&apos;t give managers more information.{" "}
                <span className={s.goldText}>Give them the next action.</span>
              </h2>
              <p className={s.body}>
                Every workforce exception lands in one prioritised queue with an owner. Managers review it, resolve it
                and close it — and nothing unresolved is left waiting for payroll to find.
              </p>
              <div className={s.verbs}>
                <span>Review</span>
                <ArrowRight size={16} />
                <span>Resolve</span>
                <ArrowRight size={16} />
                <span>Close</span>
              </div>
            </div>
            <ActionCentre />
          </div>
        </section>

        {/* PAYROLL READINESS */}
        <section className={`${s.section} ${s.light}`} aria-labelledby="payroll-title">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow>Payroll readiness</Eyebrow>
              <h2 id="payroll-title" className={s.h2}>
                Payroll should never be the first time{" "}
                <span className={s.emeraldText}>you discover a workforce problem.</span>
              </h2>
              <p className={s.body}>
                UMORA monitors payroll risk every day, so missing clock-outs, overtime and leave discrepancies are
                resolved in the week before close — not after it.
              </p>
            </div>
            <PayrollReadiness />
          </div>
        </section>

        {/* INTELLIGENCE */}
        <section className={`${s.section} ${s.dark}`} aria-labelledby="intel-title">
          <div className={`${s.container} ${s.split} ${s.splitCenter}`}>
            <InsightCard />
            <div>
              <Eyebrow>Workforce intelligence</Eyebrow>
              <h2 id="intel-title" className={s.h2}>
                From workforce data <span className={s.emeraldText}>to workforce intelligence.</span>
              </h2>
              <p className={s.body}>
                UMORA reads your own clocking, roster, leave and exception history to surface patterns and risk before
                payroll close — and pairs each insight with a recommended operational action and an owner.
              </p>
              <ul className={`${s.ticks} ${s.ticksDark}`}>
                <li>Trend views by team and site</li>
                <li>Pattern detection for workforce exceptions</li>
                <li>Operational recommendations, not just alerts</li>
              </ul>
            </div>
          </div>
        </section>

        {/* HR */}
        <section className={`${s.section} ${s.white}`} aria-labelledby="hr-title">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow>HR operations</Eyebrow>
              <h2 id="hr-title" className={s.h2}>
                HR should be a workflow. <span className={s.emeraldText}>Not a filing cabinet.</span>
              </h2>
              <p className={s.body}>
                Cases, warnings and documents move through a structured, routed workflow — with the manager involved
                and the full history kept on record.
              </p>
            </div>
            <ol className={s.hrFlow}>
              {hrFlow.map(({ icon: Icon, name }, i) => (
                <li key={name}>
                  <span className={s.hrIcon}>
                    <Icon size={22} strokeWidth={1.7} />
                  </span>
                  <strong>{name}</strong>
                  {i < hrFlow.length - 1 ? <span className={s.hrArrow} aria-hidden="true" /> : null}
                </li>
              ))}
            </ol>
            <p className={s.quote}>&ldquo;A more organised workforce. A stronger tomorrow.&rdquo;</p>
          </div>
        </section>

        {/* MOBILE */}
        <section className={`${s.section} ${s.light}`} aria-labelledby="mobile-title">
          <div className={`${s.container} ${s.split} ${s.splitCenter}`}>
            <div>
              <Eyebrow>Mobile workforce</Eyebrow>
              <h2 id="mobile-title" className={s.h2}>
                Your workforce doesn&apos;t sit at a desk.{" "}
                <span className={s.emeraldText}>Neither should UMORA.</span>
              </h2>
              <p className={s.body}>
                Employees clock in, request leave and find their documents from their phone. Managers approve, follow up
                exceptions and act on the floor — not at the end of the day.
              </p>
            </div>
            <MobilePair />
          </div>
        </section>

        {/* INDUSTRIES */}
        <section className={`${s.section} ${s.white}`} aria-labelledby="industries-title">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow>Industries</Eyebrow>
              <h2 id="industries-title" className={s.h2}>
                Built for the way <span className={s.emeraldText}>people actually work.</span>
              </h2>
            </div>
            <div className={s.industryGrid}>
              {industries.map((industry, i) => {
                const Icon = industryIcons[industry.slug] ?? Users;
                const label = industry.slug === "mining-contractors" ? "Mining" : industry.name;
                return (
                  <Link
                    key={industry.slug}
                    href={`/industries/${industry.slug}`}
                    className={s.industry}
                    style={{ ["--hue" as string]: industryHues[i % industryHues.length] }}
                  >
                    <span className={s.industryIcon}>
                      <Icon size={26} strokeWidth={1.5} />
                    </span>
                    <strong>{label}</strong>
                    <span className={s.industryText}>{industry.outcome}</span>
                    <ArrowRight size={16} className={s.industryArrow} />
                  </Link>
                );
              })}
              <Link href={links.demo} className={`${s.industry} ${s.industryCta}`}>
                <span className={s.industryIcon}>
                  <ArrowRight size={26} strokeWidth={1.5} />
                </span>
                <strong>Your industry?</strong>
                <span className={s.industryText}>Talk to us about how your teams work.</span>
              </Link>
            </div>
          </div>
        </section>

        {/* TRANSFORMATION */}
        <section className={`${s.section} ${s.dark}`} aria-labelledby="transform-title">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <Eyebrow>The shift</Eyebrow>
              <h2 id="transform-title" className={s.h2}>
                From clocking <span className={s.goldText}>to intelligence.</span>
              </h2>
            </div>
            <div className={s.transform}>
              <div className={s.transformOld}>
                <div className={s.transformLabel}>Traditional</div>
                <ol className={s.oldFlow}>
                  <li>Clock</li>
                  <li>Timesheet</li>
                  <li>Payroll</li>
                </ol>
                <p>Hours are counted. Problems are discovered at payroll — after the money has moved.</p>
              </div>
              <div className={s.transformNew}>
                <div className={s.transformLabel}>
                  <UmoraMark size={16} /> UMORA
                </div>
                <ol className={s.newFlow}>
                  {transformation.map((step, i) => (
                    <li key={step}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* BRAND PHILOSOPHY */}
        <section className={`${s.section} ${s.cinema}`} aria-labelledby="brand-title">
          <div className={s.cinemaGlow} aria-hidden="true" />
          <div className={`${s.container} ${s.cinemaInner}`}>
            <UmoraMark size={54} />
            <h2 id="brand-title" className={s.cinemaWord}>
              {brand.name}
            </h2>
            <p className={s.cinemaCategory}>{brand.category}</p>
            <ul className={s.pillars}>
              {brand.pillars.map((pillar) => (
                <li key={pillar}>{pillar}</li>
              ))}
            </ul>
            <p className={s.cinemaStatement}>&ldquo;{brand.statement}&rdquo;</p>
            <p className={s.cinemaNote}>
              Inspired by the Italian <em>umano</em> — human.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className={`${s.section} ${s.white}`} aria-labelledby="faq-title">
          <div className={`${s.container} ${s.split}`}>
            <div>
              <Eyebrow>Questions</Eyebrow>
              <h2 id="faq-title" className={s.h2}>
                What decision&#8209;makers ask <span className={s.emeraldText}>before rollout.</span>
              </h2>
              <Link href="/pricing" className={`${s.btn} ${s.btnOutline}`}>
                See pricing <ArrowRight size={16} />
              </Link>
            </div>
            <div className={s.faqList}>
              {landingFaqs.map((faq) => (
                <details key={faq.q} className={s.faq}>
                  <summary>{faq.q}</summary>
                  <p>{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className={`${s.section} ${s.finalCta}`} aria-labelledby="cta-title">
          <div className={`${s.container} ${s.finalInner}`}>
            <div>
              <h2 id="cta-title" className={s.h2}>
                Your people are already generating data.{" "}
                <span className={s.goldText}>UMORA turns it into intelligence.</span>
              </h2>
              <p className={s.body}>
                See how UMORA connects attendance, people, rostering, HR operations and payroll readiness in one
                intelligent workforce platform.
              </p>
              <div className={s.ctaRow}>
                <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
                  Book a demo <ArrowRight size={17} />
                </Link>
                <Link href={links.start} className={`${s.btn} ${s.btnGhost}`}>
                  Start your journey
                </Link>
              </div>
            </div>
            <p className={s.scriptLarge} aria-hidden="true">
              People build brighter futures.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
