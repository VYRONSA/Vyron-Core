"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  FileText,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";

type SigningLinkRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  document_id: string;
  signing_token: string;
  delivery_channel: string;
  recipient_phone: string | null;
  status: string;
  expires_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  created_at: string;
};

type GeneratedDocumentRow = {
  id: string;
  company_id: string | null;
  employee_id: string;
  template_id: string | null;
  document_type: string;
  document_title: string;
  filled_values: Record<string, any>;
  generated_word_html?: string | null;
  signature_status: string;
  signed_at: string | null;
  signed_by_name: string | null;
  signature_bucket: string | null;
  signature_path: string | null;
  created_at: string;
};

type EmployeeRow = {
  id: string;
  company_id?: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function formatText(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";

  try {
    return new Date(value).toLocaleString("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function isExpired(value: string | null | undefined) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

export default function SignContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [token, setToken] = useState("");
  const [signingLink, setSigningLink] = useState<SigningLinkRow | null>(null);
  const [documentRecord, setDocumentRecord] = useState<GeneratedDocumentRow | null>(null);
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);

  const [signerName, setSignerName] = useState("");
  const [signatureConsent, setSignatureConsent] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signingStep, setSigningStep] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locked = useMemo(() => {
    if (!signingLink) return true;
    if (signingLink.status !== "active") return true;
    if (isExpired(signingLink.expires_at)) return true;
    if (documentRecord?.signature_status === "signed") return true;
    return false;
  }, [signingLink, documentRecord]);

  useEffect(() => {
    params.then((resolved) => setToken(resolved.token));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    loadSigningData();
  }, [token]);

  useEffect(() => {
    if (!documentRecord || !employee) return;

    setSignerName(employeeName(employee));
    window.setTimeout(() => prepareSignatureCanvas(), 80);
  }, [documentRecord, employee]);

  async function loadSigningData() {
    setLoading(true);
    setError(null);
    setWarning(null);

    const { data: linkData, error: linkError } = await supabase
      .from("document_signing_links")
      .select("*")
      .eq("signing_token", token)
      .maybeSingle();

    if (linkError) {
      setError(linkError.message);
      setLoading(false);
      return;
    }

    if (!linkData) {
      setError("Signing link not found.");
      setLoading(false);
      return;
    }

    const loadedLink = linkData as SigningLinkRow;
    setSigningLink(loadedLink);

    if (!loadedLink.opened_at) {
      await supabase
        .from("document_signing_links")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", loadedLink.id);
    }

    const [documentResult, employeeResult] = await Promise.all([
      supabase
        .from("employee_generated_documents")
        .select("*")
        .eq("id", loadedLink.document_id)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id,company_id,employee_number,first_name,last_name,phone,email")
        .eq("id", loadedLink.employee_id)
        .maybeSingle(),
    ]);

    if (documentResult.error) {
      setError(documentResult.error.message);
      setLoading(false);
      return;
    }

    if (employeeResult.error) {
      setError(employeeResult.error.message);
      setLoading(false);
      return;
    }

    setDocumentRecord(documentResult.data as GeneratedDocumentRow);
    setEmployee(employeeResult.data as EmployeeRow);
    setLoading(false);
  }

  function prepareSignatureCanvas() {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const width = 760;
    const height = 220;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = "100%";
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#0f172a";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    setHasDrawnSignature(false);
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || locked || signing) return;

    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);

    context.beginPath();
    context.moveTo(point.x, point.y);
    setDrawing(true);
  }

  function drawSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || locked || signing) return;

    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasDrawnSignature(true);
  }

  function endSignature() {
    setDrawing(false);
  }

  async function safeCreateHrDocument(
    employeeRow: EmployeeRow,
    documentRow: GeneratedDocumentRow,
    signaturePath: string
  ) {
    const commonPayload = {
      employee_id: employeeRow.id,
      employee_name: employeeName(employeeRow),
      document_type: documentRow.document_type,
      document_title: documentRow.document_title,
      document_notes: "Signed remotely via VYRON CORE secure signing link.",
      file_name: `${documentRow.document_title}.signature.png`,
      file_url: null,
      file_bucket: "hr-signatures",
      file_path: signaturePath,
      status: "signed",
      uploaded_by: "VYRON CORE",
    };

    const { error: insertError } = await supabase.from("hr_documents").insert(commonPayload);

    if (insertError) {
      setWarning(
        `Contract signed, but HR Documents vault insert needs checking: ${insertError.message}`
      );
    }
  }

  async function signDocument() {
    if (!signingLink || !documentRecord || !employee) return;

    if (locked) {
      setError("This signing link is no longer active.");
      return;
    }

    if (!signerName.trim()) {
      setError("Signer name is required.");
      return;
    }

    if (!hasDrawnSignature) {
      setError("Please draw your signature before signing.");
      return;
    }

    if (!signatureConsent) {
      setError("Please tick the consent box before signing.");
      return;
    }

    const canvas = signatureCanvasRef.current;

    if (!canvas) {
      setError("Signature pad is not ready.");
      return;
    }

    setSigning(true);
    setSigningStep("Preparing signature...");
    setError(null);
    setWarning(null);
    setMessage(null);

    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((createdBlob) => resolve(createdBlob), "image/png");
      });

      if (!blob) {
        throw new Error("Could not create signature image.");
      }

      const companyScope = documentRecord.company_id || employee.company_id;
      if (!companyScope) {
        throw new Error("Signing context is missing company scope.");
      }

      const signaturePath = `${companyScope}/${employee.id}/${documentRecord.id}/${Date.now()}-remote-employee-signature.png`;

      setSigningStep("Uploading signature...");
      const { error: uploadError } = await supabase.storage
        .from("hr-signatures")
        .upload(signaturePath, blob, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) throw new Error(uploadError.message);

      setSigningStep("Saving signature audit...");
      const { error: signatureError } = await supabase.from("digital_signatures").insert({
        company_id: documentRecord.company_id || employee.company_id || null,
        employee_id: employee.id,
        document_id: documentRecord.id,
        signature_bucket: "hr-signatures",
        signature_path: signaturePath,
        signer_name: signerName.trim(),
        signer_role: "employee_remote_whatsapp",
        user_agent: typeof window !== "undefined" ? window.navigator.userAgent : null,
        consent_text:
          "I confirm that I have read this document, understand its contents, and sign/acknowledge it electronically via secure signing link.",
      });

      if (signatureError) throw new Error(signatureError.message);

      setSigningStep("Marking contract as signed...");
      const signedAt = new Date().toISOString();

      const { error: documentError } = await supabase
        .from("employee_generated_documents")
        .update({
          signature_status: "signed",
          signed_at: signedAt,
          signed_by_name: signerName.trim(),
          signature_bucket: "hr-signatures",
          signature_path: signaturePath,
          audit_user_agent: typeof window !== "undefined" ? window.navigator.userAgent : null,
        })
        .eq("id", documentRecord.id);

      if (documentError) throw new Error(documentError.message);

      setSigningStep("Closing signing link...");
      const { error: linkError } = await supabase
        .from("document_signing_links")
        .update({
          status: "signed",
          signed_at: signedAt,
        })
        .eq("id", signingLink.id);

      if (linkError) throw new Error(linkError.message);

      setSigningStep("Saving to HR document vault...");
      await safeCreateHrDocument(employee, documentRecord, signaturePath);

      setMessage("Contract signed successfully. The signed copy has returned to VYRON CORE.");
      await loadSigningData();
    } catch (signError: any) {
      setError(signError?.message || "Signing failed.");
    }

    setSigningStep("");
    setSigning(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-4 text-slate-950">
        <div className="rounded-[34px] bg-white p-8 text-center shadow-xl">
          <FileText className="mx-auto h-10 w-10 text-blue-600" />
          <h1 className="mt-4 text-2xl font-black">Loading contract...</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-5xl">
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
            VYRON CORE
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">
            Secure Contract Signing
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
            This page is locked for signing only. Contract details cannot be edited here.
          </p>
        </header>

        {error && (
          <section className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {error}
          </section>
        )}

        {warning && (
          <section className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-700">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {warning}
          </section>
        )}

        {message && (
          <section className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="mr-2 inline h-4 w-4" />
            {message}
          </section>
        )}

        {!documentRecord || !employee || !signingLink ? (
          <section className="mt-6 rounded-[34px] bg-white p-8 text-center shadow-xl">
            <AlertTriangle className="mx-auto h-10 w-10 text-rose-600" />
            <h2 className="mt-4 text-2xl font-black">Signing link unavailable</h2>
          </section>
        ) : (
          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <h2 className="text-2xl font-black text-slate-950">
                  {documentRecord.document_title}
                </h2>
              </div>

              <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-900">
                Employee: {employeeName(employee)} · Status:{" "}
                {formatText(documentRecord.signature_status)}
              </div>

              {documentRecord.generated_word_html && (
                <div className="mt-5 rounded-2xl bg-white p-5">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                    Contract Wording Preview
                  </div>
                  <div
                    className="prose prose-sm mt-3 max-h-[520px] overflow-auto text-slate-800"
                    dangerouslySetInnerHTML={{ __html: documentRecord.generated_word_html }}
                  />
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {Object.entries(documentRecord.filled_values || {}).map(([key, value]) => (
                  <div key={key} className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      {formatText(key)}
                    </div>
                    <div className="mt-2 text-sm font-bold text-slate-950">
                      {String(value || "Not set")}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
                Link expiry: {formatDateTime(signingLink.expires_at)}
                <br />
                Opened: {formatDateTime(signingLink.opened_at)}
              </div>
            </div>

            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                <h2 className="text-2xl font-black text-slate-950">
                  Signature
                </h2>
              </div>

              {locked ? (
                <div className="mt-5 rounded-2xl bg-amber-50 p-5 text-sm font-semibold leading-6 text-amber-800">
                  This link is no longer available for signing. It may already be signed,
                  expired, or disabled.
                </div>
              ) : (
                <>
                  <label className="mt-5 block text-sm font-bold text-slate-800">
                    Signer Name
                    <input
                      value={signerName}
                      onChange={(event) => setSignerName(event.target.value)}
                      disabled={signing}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500 disabled:opacity-60"
                    />
                  </label>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <canvas
                      ref={signatureCanvasRef}
                      onPointerDown={startSignature}
                      onPointerMove={drawSignature}
                      onPointerUp={endSignature}
                      onPointerLeave={endSignature}
                      className="block touch-none"
                    />
                  </div>

                  <button
                    onClick={prepareSignatureCanvas}
                    disabled={signing}
                    className="mt-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-60"
                  >
                    Clear Signature
                  </button>

                  <label className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-800">
                    <input
                      type="checkbox"
                      checked={signatureConsent}
                      disabled={signing}
                      onChange={(event) => setSignatureConsent(event.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      I confirm that I have read this document, understand its contents,
                      and sign/acknowledge it electronically.
                    </span>
                  </label>

                  {signingStep && (
                    <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
                      <RefreshCcw className="mr-2 inline h-4 w-4 animate-spin" />
                      {signingStep}
                    </div>
                  )}

                  <button
                    onClick={signDocument}
                    disabled={signing}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white disabled:bg-slate-300"
                  >
                    <FileSignature className="h-4 w-4" />
                    {signing ? "Signing..." : "Sign Contract"}
                  </button>
                </>
              )}

              <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-900">
                This secure page allows signing only. The employee cannot edit names,
                rates, dates, position, or any contract fields.
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
