import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CalendarDays,
  CalendarRange,
  CircleAlert,
  Clock,
  FileText,
  Fingerprint,
  Play,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRound,
  Users,
  Wallet,
  CalendarCheck,
  Route,
  type LucideIcon,
} from "lucide-react";
import JsonLd from "@/components/marketing/JsonLd";
import {
  ActionTable,
  AppPhones,
  ClockPhone,
  HeroDashboard,
  HrFlow,
  InsightCard,
  PayrollBoard,
  RosterTable,
  Swoosh,
  WorkforceMap,
} from "@/components/marketing/umora/visuals";
import s from "@/components/marketing/umora/umora.module.css";
import { industries, plans, siteUrl } from "@/lib/marketing/site";
import { brand, demoKpis, links, seo } from "@/lib/marketing/umora";
import { heroPerson, industryImages, workforcePortraits } from "@/lib/marketing/umora-media";

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

const heroValues: { icon: LucideIcon; label: string }[] = [
  { icon: UserRound, label: "Reduce Payroll Leakage" },
  { icon: Clock, label: "Improve Productivity" },
  { icon: BarChart3, label: "Real-time Visibility" },
  { icon: ShieldCheck, label: "Simplify Compliance" },
  { icon: Users, label: "A Happier Workforce" },
];

const kpiIcons: { icon: LucideIcon; tone: string }[] = [
  { icon: UserRound, tone: s.kpiTeal },
  { icon: CalendarDays, tone: s.kpiTeal },
  { icon: CircleAlert, tone: s.kpiRed },
  { icon: Clock, tone: s.kpiGold },
];

const platform: { icon: LucideIcon; name: string; text: string }[] = [
  { icon: Users, name: "People", text: "Employee records, roles, branches and workforce profiles." },
  { icon: Clock, name: "Clocking", text: "GPS and photo-verified attendance." },
  { icon: CalendarDays, name: "Rostering", text: "Plan shifts and align people with operational demand." },
  { icon: CalendarRange, name: "Leave", text: "Digital requests, approvals and policy-aware visibility." },
  { icon: Route, name: "Manager Actions", text: "One place to resolve workforce exceptions." },
  { icon: Briefcase, name: "HR Operations", text: "Cases, warnings and employee workflows." },
  { icon: FileText, name: "Documents", text: "Centralised employee and compliance documents." },
  { icon: ShieldCheck, name: "Compliance", text: "Track policies, exceptions and historical records." },
  { icon: Wallet, name: "Payroll Readiness", text: "Identify attendance, overtime and payroll risk before close." },
  { icon: Sparkles, name: "Intelligence", text: "Surface workforce patterns, risks and operational insights." },
];

const clockStory: { icon: LucideIcon; name: string; text: string }[] = [
  { icon: Fingerprint, name: "Attendance", text: "Captured and verified" },
  { icon: CalendarCheck, name: "Shift", text: "Matched to roster" },
  { icon: Timer, name: "Overtime", text: "Automatically calculated" },
  { icon: Wallet, name: "Payroll", text: "Ready for processing" },
  { icon: Sparkles, name: "Insight", text: "Turned into intelligence" },
];

export default function LandingPage() {
  return (
    <>
      <JsonLd data={organizationSchema} />
      <JsonLd data={softwareSchema} />

      <main className={s.page}>
        {/* ============================== HERO ============================== */}
        <section className={s.hero} aria-labelledby="hero-title">
          <div className={s.heroBackdrop} aria-hidden="true" />
          <svg className={s.heroStreaks} viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-20 600 C 60 420, 40 260, 180 60" />
            <path d="M-40 560 C 40 400, 30 280, 150 90" />
            <path d="M-10 610 C 90 470, 100 330, 240 150" />
          </svg>

          <div className={`${s.container} ${s.heroGrid}`}>
            <div className={s.heroCopy}>
              <h1 id="hero-title" className={s.heroTitle}>
                <span>Your people</span>
                <span>are your business.</span>
                <span className={s.mint}>Make them visible.</span>
              </h1>
              <p className={s.heroLead}>
                From attendance and rostering to HR operations, payroll readiness and workforce intelligence —{" "}
                <span className={s.mint}>UMORA</span> connects the entire working day in one intelligent platform.
              </p>
              <div className={s.heroCtas}>
                <Link href={links.demo} className={`${s.btn} ${s.btnGold}`}>
                  Book a Demo <ArrowRight />
                </Link>
                <a href={links.explore} className={`${s.btn} ${s.btnOutline}`}>
                  Explore UMORA
                  <span className={s.playDot}>
                    <Play />
                  </span>
                </a>
              </div>
              <ul className={s.heroValues}>
                {heroValues.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <Icon />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={s.heroStage}>
              <div className={s.heroPerson}>
                <Image
                  src={heroPerson.src}
                  alt={heroPerson.alt}
                  fill
                  priority
                  sizes="(max-width: 1024px) 50vw, 26vw"
                />
              </div>
              <div className={s.heroGlass} aria-hidden="true">
                <p className={s.heroScript}>
                  <span>People</span>
                  <span>Time</span>
                  <span>Work</span>
                  <span>Intelligence</span>
                </p>
                <Swoosh className={s.heroSwoosh} />
              </div>
              <div className={s.heroDash}>
                <HeroDashboard />
              </div>
              <p className={s.heroReal} aria-hidden="true">
                <span>Real</span>
                <span>People</span>
                <span className={s.mint}>Real</span>
                <span>Business</span>
              </p>
            </div>
          </div>
        </section>

        {/* ============================ HUMAN SIDE =========================== */}
        <section className={s.human} aria-labelledby="human-title">
          <div className={`${s.container} ${s.humanGrid}`}>
            <div className={s.humanCopy}>
              <p className={s.eyebrow}>The human side of business</p>
              <h2 id="human-title" className={s.h2}>
                Just became intelligent.
              </h2>
              <p className={s.body}>
                Every business depends on people. UMORA gives you the clarity to know who is working, where they are,
                when they should be working, what happened, why an exception occurred, how it affects payroll and what
                the manager needs to do next — all in one intelligent platform.
              </p>
            </div>
            <ul className={s.portraits}>
              {workforcePortraits.map((p) => (
                <li key={p.label} className={s.portrait}>
                  <Image src={p.src} alt={p.alt} fill sizes="(max-width: 640px) 40vw, 150px" />
                  <span>{p.label}</span>
                </li>
              ))}
            </ul>
            <p className={`${s.script} ${s.humanScript}`} aria-hidden="true">
              <span>Different</span>
              <span>people</span>
              <span>Same purpose</span>
            </p>
          </div>
        </section>

        {/* ============================= LIVE MAP ============================ */}
        <section className={s.live} aria-labelledby="live-title">
          <div className={`${s.container} ${s.liveGrid}`}>
            <div className={s.liveCopy}>
              <h2 id="live-title" className={`${s.h2} ${s.h2Light}`}>
                See your workforce
                <span className={s.mint}>as it happens.</span>
              </h2>
              <p className={s.liveLead}>Live visibility across all your sites, teams and shifts.</p>
              <ul className={s.kpis} aria-label="Workforce snapshot (demo data)">
                {demoKpis.map((kpi, i) => {
                  const { icon: Icon, tone } = kpiIcons[i];
                  return (
                    <li key={kpi.label} className={s.kpi}>
                      <span className={`${s.kpiIcon} ${tone}`}>
                        <Icon />
                      </span>
                      <span>
                        <b>{kpi.value}</b>
                        <em>{kpi.label}</em>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className={s.liveMap}>
              <WorkforceMap />
              <p className={`${s.script} ${s.mapScript}`} aria-hidden="true">
                <span>One Workforce.</span>
                <span>Multiple Locations.</span>
                <span>Total Visibility.</span>
              </p>
            </div>
          </div>
        </section>

        {/* ======================= PLATFORM + CLOCK-IN ======================= */}
        <section id="platform" className={s.band} aria-labelledby="platform-title">
          <div className={`${s.container} ${s.platformGrid}`}>
            <div>
              <h2 id="platform-title" className={s.h3Green}>
                One workforce. One intelligent platform.
              </h2>
              <p className={s.subLead}>Everything you need to manage your people, time and operations — in one place.</p>
              <div className={s.features}>
                {platform.map(({ icon: Icon, name, text }) => (
                  <article key={name} className={s.feature}>
                    <Icon className={s.featureIcon} />
                    <h3>{name}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className={s.clock}>
              <div className={s.clockHead}>
                <h2 className={s.h3Split}>
                  <span className={s.green}>Every clock&#8209;in</span>
                  <span>tells a story.</span>
                </h2>
                <Link href={links.features} className={s.textLink}>
                  Explore All Features
                </Link>
              </div>
              <div className={s.clockBody}>
                <ClockPhone />
                <ol className={s.story}>
                  {clockStory.map(({ icon: Icon, name, text }) => (
                    <li key={name}>
                      <span className={s.storyIcon}>
                        <Icon />
                      </span>
                      <span>
                        <b>{name}</b>
                        <em>{text}</em>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* =================== ROSTER / ACTIONS / PAYROLL =================== */}
        <section className={s.bandTight} aria-label="Rostering, Manager Action Centre and Payroll Readiness">
          <div className={`${s.container} ${s.trio}`}>
            <article className={s.panel}>
              <p className={s.eyebrow}>Rostering</p>
              <h2 className={s.panelTitle}>
                Put the right people
                <br />
                in the right place.
              </h2>
              <RosterTable />
            </article>
            <article className={s.panel}>
              <p className={s.eyebrow}>Manager Action Centre</p>
              <h2 className={s.panelTitle}>
                Don&apos;t give managers more
                <br />
                information. Give them the next action.
              </h2>
              <ActionTable />
            </article>
            <article className={s.panel}>
              <p className={s.eyebrow}>Payroll Readiness</p>
              <h2 className={s.panelTitle}>
                Payroll should never be the first time you discover a workforce problem.
              </h2>
              <PayrollBoard />
            </article>
          </div>
        </section>

        {/* =================== INTELLIGENCE / HR / MOBILE ==================== */}
        <section className={s.bandTight} aria-label="Workforce intelligence, HR workflow and mobile apps">
          <div className={`${s.container} ${s.trio} ${s.trioSecond}`}>
            <article className={s.panelPlain}>
              <h2 className={s.panelTitle}>
                From workforce data
                <br />
                to workforce intelligence.
              </h2>
              <InsightCard />
            </article>
            <article className={s.panelPlain}>
              <h2 className={s.panelTitle}>
                HR should be a workflow.
                <br />
                Not a filing cabinet.
              </h2>
              <div className={s.hrBox}>
                <HrFlow />
              </div>
              <p className={s.quote}>&ldquo;A more organised workforce. A stronger tomorrow.&rdquo;</p>
            </article>
            <article className={`${s.panelPlain} ${s.mobilePanel}`}>
              <h2 className={s.mobileTitle}>
                <span>Your workforce</span>
                <span>doesn&apos;t sit at a desk.</span>
                <span>
                  Neither should <span className={s.green}>UMORA.</span>
                </span>
              </h2>
              <AppPhones />
            </article>
          </div>
        </section>

        {/* ============================ INDUSTRIES =========================== */}
        <section className={s.industries} aria-labelledby="industries-title">
          <div className={s.container}>
            <h2 id="industries-title" className={s.h3Green}>
              Built for the way people actually work.
            </h2>
            <ul className={s.industryStrip}>
              {industries.map((industry) => {
                const img = industryImages[industry.slug];
                const label = industry.slug === "mining-contractors" ? "Mining" : industry.name;
                return (
                  <li key={industry.slug}>
                    <Link href={`/industries/${industry.slug}`} className={s.industry}>
                      {img ? <Image src={img.src} alt={img.alt} fill sizes="(max-width: 1024px) 40vw, 130px" /> : null}
                      <span>{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
