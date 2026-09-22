import type { Metadata } from "next";
import { PageHero, Section, UmoraPage, pageStyles as p } from "@/components/marketing/umora/PageKit";

// Legal wording is reproduced exactly as approved; only the page layout uses
// the UMORA visual system. "VYRON Software" is the company named in the policy.
export const metadata: Metadata = { title: "Privacy Policy | VYRON Software" };

export default function PrivacyPage() {
  return (
    <UmoraPage>
      <PageHero eyebrow="Legal" title="Privacy Policy" ctas={false} compact />
      <Section label="Privacy Policy">
        <div className={p.legal}>
          <p className={p.legalMeta}>Effective date: 15 May 2026</p>
          <p>VYRON Software respects your privacy. We may collect basic contact information when you contact us, including your name, email address, company name, phone number and enquiry details.</p>
          <p>We use this information to respond to enquiries, provide information about VYRON products and operate our business software services.</p>
          <p>We do not sell personal information. For privacy questions, contact info@vyronsoft.co.za.</p>
        </div>
      </Section>
    </UmoraPage>
  );
}
