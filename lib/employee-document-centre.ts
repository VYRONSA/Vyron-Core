import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentSourceTable = "employee_documents" | "employee_generated_documents";

export const DOCUMENT_CLASSIFICATIONS = [
  "employment_contract",
  "signed_contract",
  "contract_amendment",
  "warning",
  "hearing",
  "hearing_outcome",
  "appeal",
  "policy",
  "qualification",
  "medical_certificate",
  "performance_review",
  "notes_attachment",
  "hr_document",
  "exit_document",
] as const;

export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];

export const DOCUMENT_BUCKET_BY_CLASS: Record<string, string> = {
  employment_contract: "hr-signed-documents",
  signed_contract: "hr-signed-documents",
  contract_amendment: "hr-signed-documents",
  warning: "employee-documents",
  hearing: "employee-documents",
  hearing_outcome: "employee-documents",
  appeal: "employee-documents",
  policy: "employee-documents",
  qualification: "employee-documents",
  medical_certificate: "employee-documents",
  performance_review: "employee-documents",
  notes_attachment: "employee-documents",
  hr_document: "employee-documents",
  exit_document: "employee-documents",
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 120);
}

function asClassification(value: unknown): DocumentClassification {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") as DocumentClassification;

  if (DOCUMENT_CLASSIFICATIONS.includes(normalized)) return normalized;
  return "hr_document";
}

function buildFilePath(input: {
  companyId: string;
  employeeId: string;
  sourceTable: DocumentSourceTable;
  sourceDocumentId: string;
  fileName: string;
}): string {
  const stamp = Date.now();
  return `${input.companyId}/${input.employeeId}/${input.sourceTable}/${input.sourceDocumentId}/${stamp}-${cleanFileName(
    input.fileName
  )}`;
}

export async function uploadDocumentBinary(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    classification: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: Buffer;
  }
): Promise<{ bucket: string; path: string; sizeBytes: number }> {
  const classification = asClassification(input.classification);
  const bucket = DOCUMENT_BUCKET_BY_CLASS[classification] || "employee-documents";
  const path = buildFilePath({
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    fileName: input.fileName,
  });

  const { error } = await supabase.storage.from(bucket).upload(path, input.fileBuffer, {
    contentType: input.mimeType || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new Error("Could not upload document to storage.");
  }

  return {
    bucket,
    path,
    sizeBytes: input.fileBuffer.length,
  };
}

async function ensureClassification(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    classification: string;
    actor: string;
  }
): Promise<void> {
  await supabase.from("employee_document_classifications").upsert(
    {
      company_id: input.companyId,
      source_table: input.sourceTable,
      source_document_id: input.sourceDocumentId,
      class_type: asClassification(input.classification),
    },
    {
      onConflict: "source_table,source_document_id",
      ignoreDuplicates: false,
    }
  );
}

export async function appendDocumentAudit(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId?: string | null;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    eventType: string;
    actor: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("employee_document_audit_history").insert({
    company_id: input.companyId,
    employee_id: input.employeeId || null,
    source_table: input.sourceTable,
    source_document_id: input.sourceDocumentId,
    event_type: input.eventType,
    event_details: input.details || {},
    actor: input.actor,
  });

  if (error) {
    throw new Error("Could not write employee document audit history.");
  }
}

export async function createDocumentVersion(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: Buffer;
    classification: string;
    actor: string;
    changeReason?: string | null;
  }
): Promise<{ versionId: string; versionNumber: number; bucket: string; path: string; sizeBytes: number }> {
  const { data: latest, error: latestError } = await supabase
    .from("employee_document_versions")
    .select("version_number")
    .eq("company_id", input.companyId)
    .eq("source_table", input.sourceTable)
    .eq("source_document_id", input.sourceDocumentId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error("Could not load latest document version.");
  }

  const nextVersion = Number(latest?.version_number || 0) + 1;

  const uploaded = await uploadDocumentBinary(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    classification: input.classification,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileBuffer: input.fileBuffer,
  });

  const { data: createdVersion, error: versionError } = await supabase
    .from("employee_document_versions")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      source_table: input.sourceTable,
      source_document_id: input.sourceDocumentId,
      version_number: nextVersion,
      file_bucket: uploaded.bucket,
      file_path: uploaded.path,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: uploaded.sizeBytes,
      change_reason: input.changeReason || null,
      created_by: input.actor,
    })
    .select("id")
    .single();

  if (versionError || !createdVersion) {
    throw new Error("Could not create employee document version.");
  }

  await ensureClassification(supabase, {
    companyId: input.companyId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    classification: input.classification,
    actor: input.actor,
  });

  await appendDocumentAudit(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    eventType: "document_version_uploaded",
    actor: input.actor,
    details: {
      versionNumber: nextVersion,
      bucket: uploaded.bucket,
      path: uploaded.path,
      changeReason: input.changeReason || null,
    },
  });

  return {
    versionId: String(createdVersion.id),
    versionNumber: nextVersion,
    bucket: uploaded.bucket,
    path: uploaded.path,
    sizeBytes: uploaded.sizeBytes,
  };
}

export async function createEmployeeDocument(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    employeeName: string;
    documentType: string;
    documentTitle: string;
    documentNotes?: string | null;
    classification: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: Buffer;
    actor: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ documentId: string; versionId: string; versionNumber: number }> {
  const documentId = randomUUID();

  const initialVersion = await createDocumentVersion(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: "employee_documents",
    sourceDocumentId: documentId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileBuffer: input.fileBuffer,
    classification: input.classification,
    actor: input.actor,
    changeReason: "Initial upload",
  });

  const { error: insertError } = await supabase.from("employee_documents").insert({
    id: documentId,
    company_id: input.companyId,
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    document_type: input.documentType,
    document_title: input.documentTitle,
    document_notes: input.documentNotes || null,
    file_name: input.fileName,
    file_bucket: initialVersion.bucket,
    file_path: initialVersion.path,
    file_mime_type: input.mimeType,
    file_size_bytes: initialVersion.sizeBytes,
    status: "active",
    uploaded_by: input.actor,
    version_number: initialVersion.versionNumber,
    document_classification: asClassification(input.classification),
    metadata_json: input.metadata || {},
  });

  if (insertError) {
    throw new Error("Could not create employee document record.");
  }

  await appendDocumentAudit(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: "employee_documents",
    sourceDocumentId: documentId,
    eventType: "document_uploaded",
    actor: input.actor,
    details: {
      classification: asClassification(input.classification),
      versionNumber: initialVersion.versionNumber,
    },
  });

  return {
    documentId,
    versionId: initialVersion.versionId,
    versionNumber: initialVersion.versionNumber,
  };
}

export async function replaceCurrentDocumentVersion(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    classification: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: Buffer;
    actor: string;
    changeReason?: string | null;
  }
): Promise<{ versionId: string; versionNumber: number }> {
  const createdVersion = await createDocumentVersion(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    classification: input.classification,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileBuffer: input.fileBuffer,
    actor: input.actor,
    changeReason: input.changeReason || "Replaced current version",
  });

  if (input.sourceTable === "employee_documents") {
    const { error } = await supabase
      .from("employee_documents")
      .update({
        file_name: input.fileName,
        file_bucket: createdVersion.bucket,
        file_path: createdVersion.path,
        file_mime_type: input.mimeType,
        file_size_bytes: createdVersion.sizeBytes,
        version_number: createdVersion.versionNumber,
      })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) {
      throw new Error("Could not update current employee document version pointer.");
    }
  }

  if (input.sourceTable === "employee_generated_documents") {
    const { error } = await supabase
      .from("employee_generated_documents")
      .update({
        file_bucket: createdVersion.bucket,
        file_path: createdVersion.path,
        template_version_number: createdVersion.versionNumber,
      })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) {
      throw new Error("Could not update generated document version pointer.");
    }
  }

  await appendDocumentAudit(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    eventType: "document_current_version_replaced",
    actor: input.actor,
    details: {
      versionNumber: createdVersion.versionNumber,
      reason: input.changeReason || null,
    },
  });

  return {
    versionId: createdVersion.versionId,
    versionNumber: createdVersion.versionNumber,
  };
}

export async function listEmployeeDocuments(
  supabase: SupabaseClient,
  input: { companyId: string; employeeId?: string; limit?: number }
): Promise<any[]> {
  const limit = Math.min(input.limit || 100, 300);

  let employeeDocumentsQuery = supabase
    .from("employee_documents")
    .select(
      "id,company_id,employee_id,document_type,document_title,document_notes,file_name,file_bucket,file_path,file_mime_type,file_size_bytes,status,version_number,document_classification,created_at,archived_at"
    )
    .eq("company_id", input.companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  let generatedDocumentsQuery = supabase
    .from("employee_generated_documents")
    .select(
      "id,company_id,employee_id,document_type,document_title,file_bucket,file_path,signature_status,template_version_number,generated_at,generated_by,archived"
    )
    .eq("company_id", input.companyId)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (input.employeeId) {
    employeeDocumentsQuery = employeeDocumentsQuery.eq("employee_id", input.employeeId);
    generatedDocumentsQuery = generatedDocumentsQuery.eq("employee_id", input.employeeId);
  }

  const [employeeDocsRes, generatedDocsRes] = await Promise.all([employeeDocumentsQuery, generatedDocumentsQuery]);

  if (employeeDocsRes.error) {
    throw new Error("Could not load employee documents.");
  }
  if (generatedDocsRes.error) {
    throw new Error("Could not load generated documents.");
  }

  const normalizedEmployee = (employeeDocsRes.data || []).map((row: any) => ({
    source_table: "employee_documents",
    source_document_id: row.id,
    ...row,
  }));

  const normalizedGenerated = (generatedDocsRes.data || []).map((row: any) => ({
    source_table: "employee_generated_documents",
    source_document_id: row.id,
    status: row.archived ? "archived" : "active",
    version_number: row.template_version_number,
    document_classification: "employment_contract",
    ...row,
  }));

  return [...normalizedEmployee, ...normalizedGenerated]
    .sort((a, b) => String(b.created_at || b.generated_at).localeCompare(String(a.created_at || a.generated_at)))
    .slice(0, limit);
}

export async function getDocumentHistory(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
  }
): Promise<{ versions: any[]; audit: any[]; classification: any | null }> {
  const [versionsRes, auditRes, classRes] = await Promise.all([
    supabase
      .from("employee_document_versions")
      .select("id,version_number,file_bucket,file_path,file_name,mime_type,size_bytes,change_reason,created_by,created_at")
      .eq("company_id", input.companyId)
      .eq("source_table", input.sourceTable)
      .eq("source_document_id", input.sourceDocumentId)
      .order("version_number", { ascending: false }),
    supabase
      .from("employee_document_audit_history")
      .select("id,event_type,event_details,actor,created_at")
      .eq("company_id", input.companyId)
      .eq("source_table", input.sourceTable)
      .eq("source_document_id", input.sourceDocumentId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("employee_document_classifications")
      .select("class_type,compliance_required,retention_policy,review_cycle_days,pii_level")
      .eq("company_id", input.companyId)
      .eq("source_table", input.sourceTable)
      .eq("source_document_id", input.sourceDocumentId)
      .maybeSingle(),
  ]);

  if (versionsRes.error) {
    throw new Error("Could not load document version history.");
  }

  if (auditRes.error) {
    throw new Error("Could not load document audit history.");
  }

  if (classRes.error) {
    throw new Error("Could not load document classification.");
  }

  return {
    versions: versionsRes.data || [],
    audit: auditRes.data || [],
    classification: classRes.data || null,
  };
}

export async function archiveDocument(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    actor: string;
    reason?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();

  if (input.sourceTable === "employee_documents") {
    const { error } = await supabase
      .from("employee_documents")
      .update({ status: "archived", archived_at: now, archived_by: input.actor })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) throw new Error("Could not archive employee document.");
  } else {
    const { error } = await supabase
      .from("employee_generated_documents")
      .update({ archived: true })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) throw new Error("Could not archive generated document.");
  }

  await appendDocumentAudit(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    eventType: "document_archived",
    actor: input.actor,
    details: {
      reason: input.reason || null,
    },
  });
}

export async function restoreDocument(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    actor: string;
  }
): Promise<void> {
  const now = new Date().toISOString();

  if (input.sourceTable === "employee_documents") {
    const { error } = await supabase
      .from("employee_documents")
      .update({ status: "active", restored_at: now, restored_by: input.actor })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) throw new Error("Could not restore employee document.");
  } else {
    const { error } = await supabase
      .from("employee_generated_documents")
      .update({ archived: false })
      .eq("id", input.sourceDocumentId)
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId);

    if (error) throw new Error("Could not restore generated document.");
  }

  await appendDocumentAudit(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
    eventType: "document_restored",
    actor: input.actor,
  });
}

export function parseSourceTable(value: unknown): DocumentSourceTable {
  const v = asText(value);
  return v === "employee_generated_documents" ? "employee_generated_documents" : "employee_documents";
}
