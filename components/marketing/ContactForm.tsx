"use client";

import { useState } from "react";
import { SALES_EMAIL } from "@/lib/marketing/umora";
import s from "./umora/umora.module.css";
import p from "./umora/pages.module.css";

// There is no server-side lead endpoint yet, so the form hands the enquiry to
// the visitor's own email app, addressed to the sales inbox. The form says so
// plainly rather than implying the details were stored.

type ContactState = {
  fullName: string;
  company: string;
  email: string;
  phone: string;
  employees: string;
  message: string;
};

const initialState: ContactState = {
  fullName: "",
  company: "",
  email: "",
  phone: "",
  employees: "",
  message: "",
};

function buildMailto(state: ContactState) {
  const subject = `UMORA demo request — ${state.company}`;
  const body = [
    `Name: ${state.fullName}`,
    `Company: ${state.company}`,
    `Work email: ${state.email}`,
    state.phone ? `Phone: ${state.phone}` : null,
    state.employees ? `Estimated employees: ${state.employees}` : null,
    "",
    state.message,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export default function ContactForm() {
  const [state, setState] = useState<ContactState>(initialState);
  const [mailto, setMailto] = useState<string | null>(null);

  const field = (key: keyof ContactState) => ({
    value: state[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setState((prev) => ({ ...prev, [key]: event.target.value })),
  });

  return (
    <form
      className={p.form}
      onSubmit={(event) => {
        event.preventDefault();
        const href = buildMailto(state);
        setMailto(href);
        window.location.href = href;
      }}
    >
      <div className={p.formRow}>
        <div className={p.field}>
          <label htmlFor="cf-name">Full name</label>
          <input id="cf-name" required autoComplete="name" {...field("fullName")} />
        </div>
        <div className={p.field}>
          <label htmlFor="cf-company">Company</label>
          <input id="cf-company" required autoComplete="organization" {...field("company")} />
        </div>
      </div>
      <div className={p.formRow}>
        <div className={p.field}>
          <label htmlFor="cf-email">Work email</label>
          <input id="cf-email" type="email" required autoComplete="email" {...field("email")} />
        </div>
        <div className={p.field}>
          <label htmlFor="cf-phone">Phone (optional)</label>
          <input id="cf-phone" type="tel" autoComplete="tel" {...field("phone")} />
        </div>
      </div>
      <div className={p.field}>
        <label htmlFor="cf-employees">Estimated employees (optional)</label>
        <input id="cf-employees" inputMode="numeric" {...field("employees")} />
      </div>
      <div className={p.field}>
        <label htmlFor="cf-message">Your current workforce challenges</label>
        <textarea id="cf-message" required rows={5} {...field("message")} />
      </div>

      <button type="submit" className={`${s.btn} ${s.btnGold}`} style={{ border: 0, cursor: "pointer" }}>
        Send enquiry
      </button>
      <p className={p.formNote}>
        Sending opens your email app with these details addressed to {SALES_EMAIL}. Nothing is stored on this website.
      </p>

      {mailto ? (
        <p className={p.formDone} role="status">
          Your email app should now be open with your enquiry ready to send. If it didn&apos;t open,{" "}
          <a href={mailto}>try again</a> or email us directly at <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.
        </p>
      ) : null}
    </form>
  );
}
