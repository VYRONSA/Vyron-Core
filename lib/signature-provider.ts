import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendDocumentAudit,
  createDocumentVersion,
  parseSourceTable,
  type DocumentSourceTable,
} from "@/lib/employee-document-centre";

export type StartSignatureSessionInput = {
  companyId: string;
  employeeId: string;
  documentId: string;
  sourceTable: DocumentSourceTable;
  startedBy: string;
  provider: string;
  signerRoles: string[];
  expiresAt?: string | null;
  recipientPhone?: string | null;
  deliveryChannel?: string | null;
  metadata?: Record<string, unknown>;
};

export type SaveNativeSignatureInput = {
  companyId: string;
  employeeId: string;
  sessionId: string;
  signingLinkId?: string | null;
  documentId: string;
  sourceTable: DocumentSourceTable;
  signerName: string;
  signerRole: string;
  signatureBase64Png: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  consentText?: string | null;
  actor: string;
};

export type UploadSignedCopyInput = {
  companyId: string;
  employeeId: string;
  sessionId: string;
  signingLinkId?: string | null;
  documentId: string;
  sourceTable: DocumentSourceTable;
  fileName: string;
  mimeType: string | null;
  fileBuffer: Buffer;
  actor: string;
  metadata?: Record<string, unknown>;
};

export type SignatureProvider = {
  key: string;
  startSession(supabase: SupabaseClient, input: StartSignatureSessionInput): Promise<{ sessionId: string; signingLinkId: string; token: string }>;
  saveNativeSignature(supabase: SupabaseClient, input: SaveNativeSignatureInput): Promise<{ signatureId: string; signaturePath: string; signatureHash: string }>;
  uploadSignedCopy(supabase: SupabaseClient, input: UploadSignedCopyInput): Promise<{ signatureId: string; versionId: string; versionNumber: number }>;
  completeSession(
    supabase: SupabaseClient,
    input: { companyId: string; employeeId: string; sessionId: string; documentId: string; sourceTable: DocumentSourceTable; actor: string }
  ): Promise<void>;
  cancelSession(
    supabase: SupabaseClient,
    input: { companyId: string; employeeId: string; sessionId: string; actor: string; reason?: string | null }
  ): Promise<void>;
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBase64(value: string): string {
  const raw = asText(value);
  const prefix = "data:image/png;base64,";
  if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  return raw;
}

function signaturePath(input: {
  companyId: string;
  employeeId: string;
  documentId: string;
  sessionId: string;
  signerRole: string;
}): string {
  const stamp = Date.now();
  return `${input.companyId}/${input.employeeId}/${input.documentId}/${input.sessionId}/${stamp}-${input.signerRole}-signature.png`;
}

function safeRole(value: string): string {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return normalized || "employee";
}

function createToken(): string {
  return randomBytes(24).toString("hex");
}

export const NativeSignaturePadProvider: SignatureProvider = {
  key: "native",

  async startSession(supabase, input) {
    const token = createToken();

    const { data: session, error: sessionError } = await supabase
      .from("signature_sessions")
      .insert({
        company_id: input.companyId,
        employee_id: input.employeeId,
        document_id: input.documentId,
        source_table: input.sourceTable,
        provider: this.key,
        status: "active",
        session_token: token,
        signer_roles: input.signerRoles,
        started_by: input.startedBy,
        metadata: input.metadata || {},
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      throw new Error("Could not create signature session.");
    }

    const linkPayload: Record<string, unknown> = {
      company_id: input.companyId,
      employee_id: input.employeeId,
      document_id: input.documentId,
      signing_token: token,
      delivery_channel: asText(input.deliveryChannel) || "native",
      recipient_phone: input.recipientPhone || null,
      status: "active",
      expires_at: input.expiresAt || null,
      provider: this.key,
      provider_payload: {
        sessionId: session.id,
        signerRoles: input.signerRoles,
      },
      last_event_at: new Date().toISOString(),
    };

    const { data: link, error: linkError } = await supabase
      .from("document_signing_links")
      .insert(linkPayload)
      .select("id")
      .single();

    if (linkError || !link) {
      throw new Error("Could not create document signing link.");
    }

    await supabase
      .from("signature_sessions")
      .update({ signing_link_id: link.id })
      .eq("id", session.id)
      .eq("company_id", input.companyId);

    await supabase.from("contract_signing_events").insert({
      company_id: input.companyId,
      document_id: input.documentId,
      signing_link_id: link.id,
      event_type: "signature_session_started",
      actor: input.startedBy,
      metadata: {
        provider: this.key,
        signerRoles: input.signerRoles,
      },
    });

    await appendDocumentAudit(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      sourceTable: input.sourceTable,
      sourceDocumentId: input.documentId,
      eventType: "signature_session_started",
      actor: input.startedBy,
      details: {
        provider: this.key,
        sessionId: session.id,
        signingLinkId: link.id,
      },
    });

    return {
      sessionId: String(session.id),
      signingLinkId: String(link.id),
      token,
    };
  },

  async saveNativeSignature(supabase, input) {
    const { data: nativeSession, error: nativeSessionError } = await supabase
      .from("signature_sessions")
      .select("id")
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .maybeSingle();

    if (nativeSessionError || !nativeSession) {
      throw new Error("Signature session not found.");
    }

    const cleaned = normalizeBase64(input.signatureBase64Png);
    const signatureBuffer = Buffer.from(cleaned, "base64");
    const signerRole = safeRole(input.signerRole);
    const path = signaturePath({
      companyId: input.companyId,
      employeeId: input.employeeId,
      documentId: input.documentId,
      sessionId: input.sessionId,
      signerRole,
    });

    const { error: uploadError } = await supabase.storage
      .from("hr-signatures")
      .upload(path, signatureBuffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      throw new Error("Could not upload native signature artifact.");
    }

    const hash = createHash("sha256").update(signatureBuffer).digest("hex");

    const { data: signature, error: signatureError } = await supabase
      .from("digital_signatures")
      .insert({
        company_id: input.companyId,
        employee_id: input.employeeId,
        document_id: input.documentId,
        signature_session_id: input.sessionId,
        signature_bucket: "hr-signatures",
        signature_path: path,
        signer_name: input.signerName,
        signer_role: signerRole,
        signing_method: "native_pad",
        signature_hash: hash,
        provider: this.key,
        provider_reference: input.sessionId,
        user_agent: input.userAgent || null,
        ip_address: input.ipAddress || null,
        consent_text: input.consentText || null,
        device_metadata: {
          userAgent: input.userAgent || null,
          ipAddress: input.ipAddress || null,
        },
      })
      .select("id")
      .single();

    if (signatureError || !signature) {
      throw new Error("Could not save native signature metadata.");
    }

    if (input.signingLinkId) {
      await supabase
        .from("document_signing_links")
        .update({ last_event_at: new Date().toISOString() })
        .eq("id", input.signingLinkId)
        .eq("company_id", input.companyId);
    }

    await supabase.from("contract_signing_events").insert({
      company_id: input.companyId,
      document_id: input.documentId,
      signing_link_id: input.signingLinkId || null,
      event_type: "native_signature_saved",
      actor: input.actor,
      metadata: {
        signatureId: signature.id,
        signerRole,
      },
    });

    await appendDocumentAudit(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      sourceTable: input.sourceTable,
      sourceDocumentId: input.documentId,
      eventType: "native_signature_saved",
      actor: input.actor,
      details: {
        signatureId: signature.id,
        signerRole,
      },
    });

    return {
      signatureId: String(signature.id),
      signaturePath: path,
      signatureHash: hash,
    };
  },

  async uploadSignedCopy(supabase, input) {
    const { data: uploadSession, error: uploadSessionError } = await supabase
      .from("signature_sessions")
      .select("id")
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .maybeSingle();

    if (uploadSessionError || !uploadSession) {
      throw new Error("Signature session not found.");
    }

    const version = await createDocumentVersion(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      sourceTable: input.sourceTable,
      sourceDocumentId: input.documentId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileBuffer: input.fileBuffer,
      classification: "signed_contract",
      actor: input.actor,
      changeReason: "Uploaded signed copy",
    });

    const hash = createHash("sha256").update(input.fileBuffer).digest("hex");

    const { data: signature, error: signatureError } = await supabase
      .from("digital_signatures")
      .insert({
        company_id: input.companyId,
        employee_id: input.employeeId,
        document_id: input.documentId,
        signature_session_id: input.sessionId,
        signing_method: "uploaded_signed_copy",
        signer_name: input.actor,
        signer_role: "uploaded_signed_copy",
        provider: this.key,
        provider_reference: input.sessionId,
        signature_hash: hash,
        signed_copy_bucket: version.bucket,
        signed_copy_path: version.path,
        signed_copy_mime_type: input.mimeType,
        signed_copy_size_bytes: version.sizeBytes,
        device_metadata: input.metadata || {},
      })
      .select("id")
      .single();

    if (signatureError || !signature) {
      throw new Error("Could not save signed copy signature metadata.");
    }

    if (input.signingLinkId) {
      await supabase
        .from("document_signing_links")
        .update({
          signed_copy_document_version_id: version.versionId,
          last_event_at: new Date().toISOString(),
        })
        .eq("id", input.signingLinkId)
        .eq("company_id", input.companyId);
    }

    await supabase.from("contract_signing_events").insert({
      company_id: input.companyId,
      document_id: input.documentId,
      signing_link_id: input.signingLinkId || null,
      event_type: "signed_copy_uploaded",
      actor: input.actor,
      metadata: {
        versionId: version.versionId,
        versionNumber: version.versionNumber,
      },
    });

    return {
      signatureId: String(signature.id),
      versionId: version.versionId,
      versionNumber: version.versionNumber,
    };
  },

  async completeSession(supabase, input) {
    const signedAt = new Date().toISOString();

    const { data: session, error: sessionError } = await supabase
      .from("signature_sessions")
      .select("id,signing_link_id")
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .maybeSingle();

    if (sessionError || !session) {
      throw new Error("Signature session not found.");
    }

    await supabase
      .from("signature_sessions")
      .update({ status: "completed", completed_at: signedAt })
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId);

    if (session.signing_link_id) {
      await supabase
        .from("document_signing_links")
        .update({ status: "signed", signed_at: signedAt, last_event_at: signedAt })
        .eq("id", session.signing_link_id)
        .eq("company_id", input.companyId);
    }

    if (input.sourceTable === "employee_generated_documents") {
      await supabase
        .from("employee_generated_documents")
        .update({ signature_status: "signed", signed_at: signedAt })
        .eq("id", input.documentId)
        .eq("company_id", input.companyId)
        .eq("employee_id", input.employeeId);
    }

    await supabase.from("contract_signing_events").insert({
      company_id: input.companyId,
      document_id: input.documentId,
      signing_link_id: session.signing_link_id || null,
      event_type: "signature_session_completed",
      actor: input.actor,
      metadata: {
        sessionId: input.sessionId,
      },
    });

    await appendDocumentAudit(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      sourceTable: input.sourceTable,
      sourceDocumentId: input.documentId,
      eventType: "signature_session_completed",
      actor: input.actor,
      details: {
        sessionId: input.sessionId,
      },
    });
  },

  async cancelSession(supabase, input) {
    const cancelledAt = new Date().toISOString();

    const { data: session, error: sessionError } = await supabase
      .from("signature_sessions")
      .select("id,employee_id,document_id,source_table,signing_link_id")
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .maybeSingle();

    if (sessionError || !session) {
      throw new Error("Signature session not found.");
    }

    await supabase
      .from("signature_sessions")
      .update({
        status: "cancelled",
        cancelled_at: cancelledAt,
        cancelled_by: input.actor,
        cancellation_reason: input.reason || null,
      })
      .eq("id", input.sessionId)
      .eq("company_id", input.companyId);

    if (session.signing_link_id) {
      await supabase
        .from("document_signing_links")
        .update({
          status: "cancelled",
          revoked_at: cancelledAt,
          revoked_by: input.actor,
          cancellation_reason: input.reason || null,
          last_event_at: cancelledAt,
        })
        .eq("id", session.signing_link_id)
        .eq("company_id", input.companyId);
    }

    await supabase.from("contract_signing_events").insert({
      company_id: input.companyId,
      document_id: session.document_id,
      signing_link_id: session.signing_link_id || null,
      event_type: "signature_session_cancelled",
      actor: input.actor,
      metadata: {
        sessionId: input.sessionId,
        reason: input.reason || null,
      },
    });

    await appendDocumentAudit(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      sourceTable: parseSourceTable(session.source_table),
      sourceDocumentId: String(session.document_id),
      eventType: "signature_session_cancelled",
      actor: input.actor,
      details: {
        reason: input.reason || null,
      },
    });
  },
};

export function getSignatureProvider(providerKey: string | null | undefined): SignatureProvider {
  const key = asText(providerKey).toLowerCase() || "native";
  if (key === "native") return NativeSignaturePadProvider;
  throw new Error(`Unsupported signature provider '${key}'.`);
}
