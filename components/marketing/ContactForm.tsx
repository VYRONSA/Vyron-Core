"use client";

import { useState } from "react";
import styles from "./marketing.module.css";

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

export default function ContactForm() {
  const [state, setState] = useState<ContactState>(initialState);
  const [submitted, setSubmitted] = useState(false);

  return (
    <article className={styles.card} style={{ gridColumn: "span 2" }}>
      <h3>Contact form</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
        style={{ marginTop: "0.9rem", display: "grid", gap: "0.75rem" }}
      >
        <input
          required
          placeholder="Full name"
          value={state.fullName}
          onChange={(event) => setState((prev) => ({ ...prev, fullName: event.target.value }))}
          className="vyron-input"
          aria-label="Full name"
        />
        <input
          required
          placeholder="Company"
          value={state.company}
          onChange={(event) => setState((prev) => ({ ...prev, company: event.target.value }))}
          className="vyron-input"
          aria-label="Company"
        />
        <input
          required
          type="email"
          placeholder="Work email"
          value={state.email}
          onChange={(event) => setState((prev) => ({ ...prev, email: event.target.value }))}
          className="vyron-input"
          aria-label="Work email"
        />
        <input
          placeholder="Phone"
          value={state.phone}
          onChange={(event) => setState((prev) => ({ ...prev, phone: event.target.value }))}
          className="vyron-input"
          aria-label="Phone"
        />
        <input
          placeholder="Estimated employees"
          value={state.employees}
          onChange={(event) => setState((prev) => ({ ...prev, employees: event.target.value }))}
          className="vyron-input"
          aria-label="Estimated employees"
        />
        <textarea
          required
          placeholder="Tell us about your current workforce challenges"
          value={state.message}
          onChange={(event) => setState((prev) => ({ ...prev, message: event.target.value }))}
          className="vyron-input"
          rows={6}
          aria-label="Message"
        />

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ border: 0 }}>
          Submit enquiry
        </button>
      </form>

      {submitted ? (
        <p className={styles.muted} style={{ marginTop: "0.8rem" }}>
          Thank you. Your details were captured in-session. Connect this form to your CRM or API endpoint for
          production lead capture.
        </p>
      ) : null}
    </article>
  );
}
