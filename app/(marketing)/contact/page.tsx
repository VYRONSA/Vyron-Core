import type { Metadata } from "next";
import { CalendarCheck, Mail, MapPin } from "lucide-react";
import ContactForm from "@/components/marketing/ContactForm";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";
import { buildPageMetadata } from "@/lib/marketing/site";
import { SALES_EMAIL } from "@/lib/marketing/umora";

export const metadata: Metadata = buildPageMetadata({
  title: "Contact | UMORA",
  description: "Book an UMORA demo and discuss rollout plans for your workforce operation.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <UmoraPage>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Book an UMORA <em>workforce intelligence demo.</em>
          </>
        }
        lead="Tell us about your operation and team size. We will walk you through UMORA and align a rollout path for your business."
        ctas={false}
        compact
      />

      <Section label="Contact UMORA">
        <div className={p.split} style={{ alignItems: "start" }}>
          <article className={p.card}>
            <h2 className={p.cardTitle} style={{ marginTop: 0, marginBottom: "1rem" }}>
              Tell us about your team
            </h2>
            <ContactForm />
          </article>

          <article className={`${p.card} ${p.cardDark}`} style={{ background: "linear-gradient(160deg, #0c2230, #061520)" }}>
            <h2 className={p.cardTitle} style={{ marginTop: 0, marginBottom: "1.2rem" }}>
              Direct channels
            </h2>
            <div className={p.channel}>
              <span className={p.cardIconBadge}>
                <Mail />
              </span>
              <div>
                <b>Email</b>
                <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>
              </div>
            </div>
            <div className={p.channel}>
              <span className={p.cardIconBadge}>
                <CalendarCheck />
              </span>
              <div>
                <b>Demo bookings</b>
                <span>Monday to Friday</span>
              </div>
            </div>
            <div className={p.channel}>
              <span className={p.cardIconBadge}>
                <MapPin />
              </span>
              <div>
                <b>Coverage</b>
                <span>Sales and implementation support for national workforce deployments in South Africa.</span>
              </div>
            </div>
          </article>
        </div>
      </Section>
    </UmoraPage>
  );
}
