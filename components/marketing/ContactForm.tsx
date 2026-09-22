"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import type { FieldErrors } from "@/lib/marketing/enquiry";
import { SALES_EMAIL } from "@/lib/marketing/umora";
import s from "./umora/umora.module.css";
import p from "./umora/pages.module.css";

type Status = "idle" | "submitting" | "sent" | "error";

type FormState = {
  name: string;
  company: string;
  email: string;
  phone: string;
  employees: string;
  message: string;
  consent: boolean;
  /** Honeypot — hidden from people, and must stay empty. */
  website: string;
};

const initialState: FormState = {
  name: "",
  company: "",
  email: "",
  phone: "",
  employees: "",
  message: "",
  consent: false,
  website: "",
};

export default function ContactForm() {
  const [state, setState] = useState<FormState>(initialState);
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const startedAt = useRef<number>(0);
  // Kept across retries so a resend of the same enquiry is de-duplicated server side.
  const requestId = useRef<string>("");

  useEffect(() => {
    startedAt.current = Date.now();
    requestId.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }, []);

  const field = (key: keyof Omit<FormState, "consent">) => ({
    value: state[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setState((prev) => ({ ...prev, [key]: event.target.value })),
    "aria-invalid": Boolean(errors[key as keyof FieldErrors]) || undefined,
    "aria-describedby": errors[key as keyof FieldErrors] ? `${key}-error` : undefined,
  });

  const error = (key: keyof FieldErrors) =>
    errors[key] ? (
      <span id={`${key}-error`} className={p.fieldError}>
        {errors[key]}
      </span>
    ) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setErrors({});
    setServerError(null);
    setUnconfigured(false);

    try {
      const response = await fetch("/api/marketing/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state, startedAt: startedAt.current, requestId: requestId.current }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data?.ok) {
        setStatus("sent");
        return;
      }

      if (data?.code === "invalid" && data.errors) {
        setErrors(data.errors as FieldErrors);
        setStatus("idle");
        return;
      }

      if (data?.code === "not_configured") {
        setUnconfigured(true);
        setStatus("error");
        return;
      }

      setServerError(data?.message || "Something went wrong. Please try again.");
      setStatus("error");
    } catch {
      setServerError("We couldn't reach the server. Please check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <p className={p.formDone} role="status">
        Thank you. Your enquiry has been received. Our team will be in touch.
      </p>
    );
  }

  return (
    <form className={p.form} onSubmit={submit}>
      <div className={p.formRow}>
        <div className={p.field}>
          <label htmlFor="cf-name">Full name</label>
          <input id="cf-name" required autoComplete="name" {...field("name")} />
          {error("name")}
        </div>
        <div className={p.field}>
          <label htmlFor="cf-company">Company</label>
          <input id="cf-company" required autoComplete="organization" {...field("company")} />
          {error("company")}
        </div>
      </div>
      <div className={p.formRow}>
        <div className={p.field}>
          <label htmlFor="cf-email">Work email</label>
          <input id="cf-email" type="email" required autoComplete="email" {...field("email")} />
          {error("email")}
        </div>
        <div className={p.field}>
          <label htmlFor="cf-phone">Phone (optional)</label>
          <input id="cf-phone" type="tel" autoComplete="tel" {...field("phone")} />
          {error("phone")}
        </div>
      </div>
      <div className={p.field}>
        <label htmlFor="cf-employees">Estimated employees (optional)</label>
        <input id="cf-employees" inputMode="numeric" {...field("employees")} />
        {error("employees")}
      </div>
      <div className={p.field}>
        <label htmlFor="cf-message">Your current workforce challenges</label>
        <textarea id="cf-message" required rows={5} {...field("message")} />
        {error("message")}
      </div>

      {/* Honeypot: off-screen and hidden from assistive technology. */}
      <div className={p.honeypot} aria-hidden="true">
        <label htmlFor="cf-website">Website</label>
        <input
          id="cf-website"
          tabIndex={-1}
          autoComplete="off"
          value={state.website}
          onChange={(event) => setState((prev) => ({ ...prev, website: event.target.value }))}
        />
      </div>

      <div className={p.consent}>
        <input
          id="cf-consent"
          type="checkbox"
          checked={state.consent}
          onChange={(event) => setState((prev) => ({ ...prev, consent: event.target.checked }))}
          aria-invalid={Boolean(errors.consent) || undefined}
          aria-describedby={errors.consent ? "consent-error" : undefined}
        />
        <label htmlFor="cf-consent">
          I agree that UMORA may use these details to contact me about this enquiry, as described in the{" "}
          <a href="/privacy">privacy policy</a>.
        </label>
      </div>
      {error("consent")}

      <button
        type="submit"
        className={`${s.btn} ${s.btnGold}`}
        style={{ border: 0, cursor: status === "submitting" ? "progress" : "pointer" }}
        disabled={status === "submitting"}
      >
        {status === "submitting" ? (
          <>
            <Loader2 className={p.spinner} /> Sending…
          </>
        ) : (
          "Send enquiry"
        )}
      </button>

      {status === "error" && unconfigured ? (
        <p className={p.formError} role="alert">
          <CircleAlert />
          <span>
            Online enquiries aren&apos;t available on this deployment yet. Please email us at{" "}
            <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a> and we&apos;ll come straight back to you.
          </span>
        </p>
      ) : null}

      {status === "error" && !unconfigured ? (
        <p className={p.formError} role="alert">
          <CircleAlert />
          <span>
            {serverError} You can also email us at <a href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a>.
          </span>
        </p>
      ) : null}

      <p className={p.formNote}>
        We use your details only to respond to this enquiry. Nothing is published on this website.
      </p>
    </form>
  );
}
