import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDocumentHistory,
  listEmployeeDocuments,
  type DocumentSourceTable,
} from "@/lib/employee-document-centre";

type CompanyRow = Record<string, unknown>;
type EmployeeRow = Record<string, unknown>;

type PdfLine = {
  text: string;
  size: number;
  color?: ReturnType<typeof rgb>;
  bold?: boolean;
};

type PdfSection = {
  heading: string;
  lines: PdfLine[];
};

export type PacketType = "disciplinary_packet" | "hearing_packet" | "employee_hr_file";

export type PdfRenderInput = {
  company: CompanyRow;
  employee: EmployeeRow;
  documentTitle: string;
  documentNumber: string;
  versionNumber: number;
  generatedBy: string;
  sections: PdfSection[];
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 46;
const MARGIN_TOP = 42;
const MARGIN_BOTTOM = 40;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asIsoNow(): string {
  return new Date().toISOString();
}

function employeeName(employee: EmployeeRow): string {
  return (
    asText(employee.name) ||
    `${asText(employee.first_name)} ${asText(employee.last_name)}`.trim() ||
    asText(employee.employee_name) ||
    "Employee"
  );
}

function companyName(company: CompanyRow): string {
  return asText(company.company_name) || asText(company.name) || "Company";
}

function companyAddress(company: CompanyRow): string {
  return asText(company.address) || asText(company.physical_address) || asText(company.postal_address) || "Address not set";
}

function companyRegistration(company: CompanyRow): string {
  return asText(company.registration_number) || asText(company.company_registration) || "N/A";
}

function toDocumentNumber(sourceTable: string, sourceDocumentId: string): string {
  const prefix = sourceTable === "employee_generated_documents" ? "CON" : "HR";
  return `${prefix}-${sourceDocumentId.slice(0, 8).toUpperCase()}`;
}

function safeVersion(value: unknown): number {
  const parsed = Number(value || 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function jsonLine(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function loadCompanyAndEmployee(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string
): Promise<{ company: CompanyRow; employee: EmployeeRow }> {
  const [companyRes, employeeRes] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
    supabase.from("employees").select("*").eq("id", employeeId).eq("company_id", companyId).maybeSingle(),
  ]);

  if (companyRes.error || !companyRes.data) {
    throw new Error("Could not load company profile for PDF generation.");
  }

  if (employeeRes.error || !employeeRes.data) {
    throw new Error("Could not load employee profile for PDF generation.");
  }

  return {
    company: companyRes.data as CompanyRow,
    employee: employeeRes.data as EmployeeRow,
  };
}

async function tryLoadCompanyLogo(
  _pdfDoc: PDFDocument,
  supabase: SupabaseClient,
  company: CompanyRow
): Promise<Uint8Array | null> {
  const logoUrl = asText(company.logo_url) || asText(company.company_logo_url) || asText(company.logo);
  if (logoUrl && (logoUrl.startsWith("http://") || logoUrl.startsWith("https://"))) {
    try {
      const response = await fetch(logoUrl);
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch {
      return null;
    }
  }

  const logoBucket = asText(company.logo_bucket);
  const logoPath = asText(company.logo_path);
  if (logoBucket && logoPath) {
    try {
      const { data } = await supabase.storage.from(logoBucket).download(logoPath);
      if (data) return new Uint8Array(await data.arrayBuffer());
    } catch {
      return null;
    }
  }

  return null;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = asText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const trial = current ? `${current} ${word}` : word;
    if (trial.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  });

  if (current) lines.push(current);
  return lines;
}

async function renderPdf(
  supabase: SupabaseClient,
  input: PdfRenderInput
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = await tryLoadCompanyLogo(pdfDoc, supabase, input.company);
  let logoImage: any = null;
  if (logoBytes) {
    try {
      if (
        logoBytes[0] === 0x89 &&
        logoBytes[1] === 0x50 &&
        logoBytes[2] === 0x4e &&
        logoBytes[3] === 0x47
      ) {
        logoImage = await pdfDoc.embedPng(logoBytes);
      } else {
        logoImage = await pdfDoc.embedJpg(logoBytes);
      }
    } catch {
      logoImage = null;
    }
  }

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN_TOP;

  const drawHeader = () => {
    page.drawRectangle({
      x: MARGIN_X,
      y: PAGE_HEIGHT - 94,
      width: PAGE_WIDTH - MARGIN_X * 2,
      height: 56,
      color: rgb(0.95, 0.97, 1),
      borderWidth: 1,
      borderColor: rgb(0.84, 0.89, 0.97),
    });

    if (logoImage) {
      page.drawImage(logoImage, {
        x: MARGIN_X + 8,
        y: PAGE_HEIGHT - 84,
        width: 36,
        height: 36,
      });
    } else {
      page.drawRectangle({
        x: MARGIN_X + 8,
        y: PAGE_HEIGHT - 84,
        width: 36,
        height: 36,
        color: rgb(0.12, 0.25, 0.6),
      });
      page.drawText(companyName(input.company).slice(0, 2).toUpperCase(), {
        x: MARGIN_X + 17,
        y: PAGE_HEIGHT - 72,
        size: 11,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    }

    page.drawText(companyName(input.company), {
      x: MARGIN_X + 54,
      y: PAGE_HEIGHT - 58,
      size: 13,
      font: fontBold,
      color: rgb(0.08, 0.14, 0.27),
    });

    page.drawText(`Reg: ${companyRegistration(input.company)} | ${companyAddress(input.company)}`, {
      x: MARGIN_X + 54,
      y: PAGE_HEIGHT - 74,
      size: 8.5,
      font: fontRegular,
      color: rgb(0.33, 0.38, 0.47),
    });

    page.drawText(input.documentTitle, {
      x: MARGIN_X,
      y: PAGE_HEIGHT - 118,
      size: 16,
      font: fontBold,
      color: rgb(0.05, 0.08, 0.15),
    });

    page.drawText(
      `Document #${input.documentNumber} | Version ${input.versionNumber} | Generated ${new Date().toLocaleString("en-ZA")}`,
      {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 132,
        size: 8.5,
        font: fontRegular,
        color: rgb(0.33, 0.38, 0.47),
      }
    );

    page.drawText(
      `Employee: ${employeeName(input.employee)} (${asText(input.employee.employee_number) || "no number"})`,
      {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 145,
        size: 9,
        font: fontRegular,
        color: rgb(0.18, 0.2, 0.27),
      }
    );

    cursorY = PAGE_HEIGHT - 164;
  };

  const drawFooter = (pageIndex: number, total: number) => {
    page.drawLine({
      start: { x: MARGIN_X, y: MARGIN_BOTTOM + 16 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: MARGIN_BOTTOM + 16 },
      thickness: 0.8,
      color: rgb(0.85, 0.88, 0.93),
    });

    page.drawText(`Audit footer: generated by ${input.generatedBy} at ${new Date().toISOString()}`, {
      x: MARGIN_X,
      y: MARGIN_BOTTOM + 5,
      size: 7,
      font: fontRegular,
      color: rgb(0.36, 0.39, 0.47),
    });

    page.drawText(`Page ${pageIndex} of ${total}`, {
      x: PAGE_WIDTH - MARGIN_X - 56,
      y: MARGIN_BOTTOM + 5,
      size: 7,
      font: fontRegular,
      color: rgb(0.36, 0.39, 0.47),
    });
  };

  const ensureSpace = (required: number) => {
    if (cursorY - required < MARGIN_BOTTOM + 30) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader();
    }
  };

  drawHeader();

  input.sections.forEach((section) => {
    ensureSpace(32);
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 18,
      width: PAGE_WIDTH - MARGIN_X * 2,
      height: 18,
      color: rgb(0.95, 0.96, 0.98),
    });

    page.drawText(section.heading, {
      x: MARGIN_X + 6,
      y: cursorY - 12,
      size: 10,
      font: fontBold,
      color: rgb(0.09, 0.13, 0.2),
    });

    cursorY -= 24;

    section.lines.forEach((line) => {
      const wrapped = wrapText(line.text, 104);
      wrapped.forEach((wrappedLine) => {
        ensureSpace(14);
        page.drawText(wrappedLine, {
          x: MARGIN_X + 6,
          y: cursorY,
          size: line.size,
          font: line.bold ? fontBold : fontRegular,
          color: line.color || rgb(0.13, 0.17, 0.25),
        });
        cursorY -= Math.max(11, line.size + 2);
      });
    });

    cursorY -= 8;
  });

  const pages = pdfDoc.getPages();
  const total = pages.length;
  pages.forEach((p, index) => {
    page = p;
    drawFooter(index + 1, total);
  });

  const bytes = await pdfDoc.save();
  return {
    bytes,
    pageCount: total,
  };
}

async function getSingleDocumentMetadata(
  supabase: SupabaseClient,
  input: { companyId: string; sourceTable: DocumentSourceTable; sourceDocumentId: string }
): Promise<any> {
  if (input.sourceTable === "employee_documents") {
    const { data, error } = await supabase
      .from("employee_documents")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("id", input.sourceDocumentId)
      .maybeSingle();

    if (error || !data) throw new Error("Employee document not found for PDF export.");
    return data;
  }

  const { data, error } = await supabase
    .from("employee_generated_documents")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.sourceDocumentId)
    .maybeSingle();

  if (error || !data) throw new Error("Generated document not found for PDF export.");
  return data;
}

async function saveExportRecord(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    packetType: string;
    exportKind: string;
    fileName: string;
    pdfBytes: Uint8Array;
    createdBy: string;
    documentsIncluded: Array<{ source_table: string; source_document_id: string; version_number?: number }>;
    pageCount: number;
    metadata?: Record<string, unknown>;
    hrCaseId?: string | null;
    hearingCaseId?: string | null;
  }
): Promise<{ exportId: string; bucket: string; path: string }> {
  const exportId = randomUUID();
  const bucket = "employee-documents";
  const path = `${input.companyId}/${input.employeeId}/hr-packets/${Date.now()}-${input.fileName}.pdf`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, Buffer.from(input.pdfBytes), {
    contentType: "application/pdf",
    upsert: false,
  });

  if (uploadError) throw new Error("Could not upload generated PDF packet.");

  const { error: insertError } = await supabase.from("hr_packet_exports").insert({
    id: exportId,
    company_id: input.companyId,
    employee_id: input.employeeId,
    hr_case_id: input.hrCaseId || null,
    hearing_case_id: input.hearingCaseId || null,
    packet_type: input.packetType,
    export_kind: input.exportKind,
    export_status: "completed",
    file_bucket: bucket,
    file_path: path,
    generated_by: input.createdBy,
    created_by: input.createdBy,
    generated_at: asIsoNow(),
    completed_at: asIsoNow(),
    documents_included: input.documentsIncluded,
    page_count: input.pageCount,
    pdf_file_size_bytes: input.pdfBytes.byteLength,
    packet_reference: `${input.packetType}-${Date.now()}`,
    metadata: {
      ...(input.metadata || {}),
      documentCount: input.documentsIncluded.length,
    },
  });

  if (insertError) throw new Error("Could not record export history.");

  return { exportId, bucket, path };
}

export async function generateIndividualDocumentPdf(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    sourceTable: DocumentSourceTable;
    sourceDocumentId: string;
    generatedBy: string;
  }
): Promise<{ exportId: string; bucket: string; path: string; pageCount: number }> {
  const [{ company, employee }, documentMeta] = await Promise.all([
    loadCompanyAndEmployee(supabase, input.companyId, input.employeeId),
    getSingleDocumentMetadata(supabase, {
      companyId: input.companyId,
      sourceTable: input.sourceTable,
      sourceDocumentId: input.sourceDocumentId,
    }),
  ]);

  const history = await getDocumentHistory(supabase, {
    companyId: input.companyId,
    sourceTable: input.sourceTable,
    sourceDocumentId: input.sourceDocumentId,
  });

  const versionNumber = safeVersion(documentMeta.version_number || documentMeta.template_version_number || 1);
  const documentTitle = asText(documentMeta.document_title) || "Employee Document";
  const documentNumber = toDocumentNumber(input.sourceTable, input.sourceDocumentId);

  const sections: PdfSection[] = [
    {
      heading: "Document Summary",
      lines: [
        { text: `Type: ${asText(documentMeta.document_type) || "N/A"}`, size: 9 },
        { text: `Classification: ${asText(documentMeta.document_classification) || asText(history.classification?.class_type) || "N/A"}`, size: 9 },
        { text: `Status: ${asText(documentMeta.status || documentMeta.signature_status) || "active"}`, size: 9 },
        { text: `Created: ${asText(documentMeta.created_at || documentMeta.generated_at)}`, size: 9 },
      ],
    },
    {
      heading: "Version History",
      lines: (history.versions || []).map((v: any) => ({
        text: `v${safeVersion(v.version_number)} | ${asText(v.file_name)} | ${asText(v.created_by)} | ${asText(v.created_at)}`,
        size: 8.5,
      })),
    },
    {
      heading: "Audit Trail",
      lines: (history.audit || []).slice(0, 80).map((a: any) => ({
        text: `${asText(a.created_at)} | ${asText(a.event_type)} | ${asText(a.actor)} | ${jsonLine(a.event_details)}`,
        size: 8,
      })),
    },
  ];

  if ((documentMeta.merge_values_json || documentMeta.filled_values) && input.sourceTable === "employee_generated_documents") {
    const values = (documentMeta.merge_values_json || documentMeta.filled_values || {}) as Record<string, unknown>;
    const valueLines = Object.entries(values).map(([key, value]) => ({
      text: `${key}: ${asText(value)}`,
      size: 8.5,
    }));
    if (valueLines.length > 0) {
      sections.splice(1, 0, {
        heading: "Merge Values",
        lines: valueLines,
      });
    }
  }

  const rendered = await renderPdf(supabase, {
    company,
    employee,
    documentTitle,
    documentNumber,
    versionNumber,
    generatedBy: input.generatedBy,
    sections,
  });

  const saved = await saveExportRecord(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    packetType: "individual_document_pdf",
    exportKind: "individual_document",
    fileName: `${documentNumber}-${documentTitle.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
    pdfBytes: rendered.bytes,
    createdBy: input.generatedBy,
    documentsIncluded: [
      {
        source_table: input.sourceTable,
        source_document_id: input.sourceDocumentId,
        version_number: versionNumber,
      },
    ],
    pageCount: rendered.pageCount,
    metadata: {
      sourceTable: input.sourceTable,
      sourceDocumentId: input.sourceDocumentId,
    },
  });

  return {
    ...saved,
    pageCount: rendered.pageCount,
  };
}

export async function generatePacketPdf(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    packetType: PacketType;
    generatedBy: string;
    hrCaseId?: string | null;
    hearingCaseId?: string | null;
  }
): Promise<{ exportId: string; bucket: string; path: string; pageCount: number; documentsIncluded: any[] }> {
  const { company, employee } = await loadCompanyAndEmployee(supabase, input.companyId, input.employeeId);

  const [documents, warningsRes, hearingsRes, timelineRes, notesRes, casesRes, versionsRes] = await Promise.all([
    listEmployeeDocuments(supabase, {
      companyId: input.companyId,
      employeeId: input.employeeId,
      limit: 300,
    }),
    supabase
      .from("hr_warnings")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("hearing_cases")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("employee_relations_timeline_events")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .order("event_date", { ascending: false })
      .limit(300),
    supabase
      .from("employee_notes")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("hr_cases")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("employee_document_versions")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("employee_id", input.employeeId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (warningsRes.error || hearingsRes.error || timelineRes.error || notesRes.error || casesRes.error || versionsRes.error) {
    throw new Error("Could not load packet data.");
  }

  const warnings = warningsRes.data || [];
  const hearings = hearingsRes.data || [];
  const timeline = timelineRes.data || [];
  const notes = notesRes.data || [];
  const hrCases = casesRes.data || [];
  const versions = versionsRes.data || [];

  const hearingIds = hearings.map((h: any) => h.id).filter(Boolean);
  const [participantsRes, evidenceRes] = await Promise.all([
    hearingIds.length > 0
      ? supabase
          .from("hearing_participants")
          .select("*")
          .eq("company_id", input.companyId)
          .in("hearing_case_id", hearingIds)
      : Promise.resolve({ data: [], error: null } as any),
    hearingIds.length > 0
      ? supabase
          .from("hearing_evidence")
          .select("*")
          .eq("company_id", input.companyId)
          .in("hearing_case_id", hearingIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (participantsRes.error || evidenceRes.error) {
    throw new Error("Could not load hearing participants/evidence.");
  }

  const participants = participantsRes.data || [];
  const evidence = evidenceRes.data || [];

  const baseSections: PdfSection[] = [
    {
      heading: "Employee Profile",
      lines: [
        { text: `Name: ${employeeName(employee)}`, size: 9 },
        { text: `Employee Number: ${asText(employee.employee_number) || "N/A"}`, size: 9 },
        { text: `Position: ${asText(employee.position || employee.job_title) || "N/A"}`, size: 9 },
        { text: `Department: ${asText(employee.department) || "N/A"}`, size: 9 },
        { text: `Branch: ${asText(employee.branch) || asText(employee.store_name) || "N/A"}`, size: 9 },
      ],
    },
  ];

  const timelineSection: PdfSection = {
    heading: "Timeline",
    lines: timeline.slice(0, 120).map((item: any) => ({
      text: `${asText(item.event_date)} | ${asText(item.event_type)} | ${asText(item.title)} | ${asText(item.summary)}`,
      size: 8,
    })),
  };

  const notesSection: PdfSection = {
    heading: "Notes",
    lines: notes.slice(0, 120).map((item: any) => ({
      text: `${asText(item.created_at)} | ${asText(item.note_category)} | ${asText(item.created_by)} | ${asText(item.note_text)}`,
      size: 8,
    })),
  };

  const documentRegisterSection: PdfSection = {
    heading: "Document Register",
    lines: documents.slice(0, 200).map((doc: any) => ({
      text: `${asText(doc.source_table)} | ${asText(doc.source_document_id)} | ${asText(doc.document_title)} | ${asText(
        doc.document_classification
      )} | v${safeVersion(doc.version_number)} | ${asText(doc.status)}`,
      size: 8,
    })),
  };

  const attachmentsIndexSection: PdfSection = {
    heading: "Attachments Index",
    lines: versions.slice(0, 250).map((v: any) => ({
      text: `${asText(v.source_table)}:${asText(v.source_document_id)} | v${safeVersion(v.version_number)} | ${asText(
        v.file_name
      )} | ${asText(v.created_at)}`,
      size: 8,
    })),
  };

  const disciplinarySections: PdfSection[] = [
    {
      heading: "Employee Summary",
      lines: [
        { text: `Warnings: ${warnings.length}`, size: 9 },
        { text: `Hearings: ${hearings.length}`, size: 9 },
        { text: `HR Cases: ${hrCases.length}`, size: 9 },
      ],
    },
    {
      heading: "Warnings",
      lines: warnings.slice(0, 120).map((w: any) => ({
        text: `${asText(w.created_at)} | ${asText(w.warning_type)} | ${asText(w.status)} | ${asText(w.description)}`,
        size: 8,
      })),
    },
    {
      heading: "Hearing Notices",
      lines: hearings.slice(0, 120).map((h: any) => ({
        text: `${asText(h.created_at)} | ${asText(h.hearing_type)} | ${asText(h.hearing_status)} | scheduled ${asText(
          h.scheduled_at
        )}`,
        size: 8,
      })),
    },
    {
      heading: "Evidence List",
      lines: evidence.slice(0, 150).map((e: any) => ({
        text: `${asText(e.submitted_at)} | hearing ${asText(e.hearing_case_id)} | ${asText(e.evidence_type)} | ${asText(
          e.file_name || e.file_path
        )} | ${asText(e.admissibility_status)}`,
        size: 8,
      })),
    },
    {
      heading: "Witness List",
      lines: participants
        .filter((p: any) => asText(p.participant_type).includes("witness"))
        .slice(0, 150)
        .map((p: any) => ({
          text: `${asText(p.created_at)} | hearing ${asText(p.hearing_case_id)} | ${asText(p.external_name)} | ${asText(
            p.attendance_status
          )}`,
          size: 8,
        })),
    },
    {
      heading: "Outcomes",
      lines: hearings
        .filter((h: any) => asText(h.outcome_summary) || asText(h.outcome_code))
        .slice(0, 120)
        .map((h: any) => ({
          text: `${asText(h.created_at)} | hearing ${asText(h.id)} | ${asText(h.outcome_code)} | ${asText(h.outcome_summary)}`,
          size: 8,
        })),
    },
    {
      heading: "Appeals",
      lines: hrCases
        .filter((c: any) => asText(c.category).includes("appeal") || asText(c.case_type).includes("appeal"))
        .slice(0, 120)
        .map((c: any) => ({
          text: `${asText(c.created_at)} | ${asText(c.title)} | ${asText(c.status)} | ${asText(c.description)}`,
          size: 8,
        })),
    },
    timelineSection,
    notesSection,
    attachmentsIndexSection,
  ];

  const hearingSections: PdfSection[] = [
    {
      heading: "Hearing Details",
      lines: hearings.slice(0, 120).map((h: any) => ({
        text: `${asText(h.created_at)} | ${asText(h.hearing_type)} | ${asText(h.hearing_status)} | scheduled ${asText(
          h.scheduled_at
        )} | outcome ${asText(h.outcome_code)}`,
        size: 8,
      })),
    },
    {
      heading: "Participants",
      lines: participants.slice(0, 200).map((p: any) => ({
        text: `hearing ${asText(p.hearing_case_id)} | ${asText(p.participant_type)} | ${asText(
          p.external_name
        )} | ${asText(p.attendance_status)}`,
        size: 8,
      })),
    },
    {
      heading: "Evidence",
      lines: evidence.slice(0, 200).map((e: any) => ({
        text: `hearing ${asText(e.hearing_case_id)} | ${asText(e.evidence_type)} | ${asText(e.file_name || e.file_path)}`,
        size: 8,
      })),
    },
    {
      heading: "Previous Warnings",
      lines: warnings.slice(0, 120).map((w: any) => ({
        text: `${asText(w.created_at)} | ${asText(w.warning_type)} | ${asText(w.status)} | ${asText(w.description)}`,
        size: 8,
      })),
    },
    {
      heading: "Related HR Cases",
      lines: hrCases.slice(0, 160).map((c: any) => ({
        text: `${asText(c.created_at)} | ${asText(c.case_type)} | ${asText(c.category)} | ${asText(c.status)} | ${asText(
          c.title
        )}`,
        size: 8,
      })),
    },
    timelineSection,
    attachmentsIndexSection,
  ];

  const employeeFileSections: PdfSection[] = [
    {
      heading: "Contracts and Amendments",
      lines: documents
        .filter((d: any) => ["employment_contract", "signed_contract", "contract_amendment"].includes(asText(d.document_classification)))
        .slice(0, 160)
        .map((d: any) => ({
          text: `${asText(d.source_table)} | ${asText(d.document_title)} | ${asText(d.status)} | v${safeVersion(
            d.version_number
          )}`,
          size: 8,
        })),
    },
    {
      heading: "Qualifications and Medical Certificates",
      lines: documents
        .filter((d: any) => ["qualification", "medical_certificate"].includes(asText(d.document_classification)))
        .slice(0, 160)
        .map((d: any) => ({
          text: `${asText(d.document_title)} | ${asText(d.document_classification)} | ${asText(d.status)} | v${safeVersion(
            d.version_number
          )}`,
          size: 8,
        })),
    },
    {
      heading: "Warnings and Hearings",
      lines: [
        ...warnings.slice(0, 120).map((w: any) => ({
          text: `Warning | ${asText(w.warning_type)} | ${asText(w.status)} | ${asText(w.description)}`,
          size: 8,
        })),
        ...hearings.slice(0, 120).map((h: any) => ({
          text: `Hearing | ${asText(h.hearing_type)} | ${asText(h.hearing_status)} | ${asText(h.outcome_summary)}`,
          size: 8,
        })),
      ],
    },
    {
      heading: "Performance Reviews and Policies",
      lines: documents
        .filter((d: any) => ["performance_review", "policy"].includes(asText(d.document_classification)))
        .slice(0, 160)
        .map((d: any) => ({
          text: `${asText(d.document_title)} | ${asText(d.document_classification)} | ${asText(d.status)} | v${safeVersion(
            d.version_number
          )}`,
          size: 8,
        })),
    },
    notesSection,
    timelineSection,
    documentRegisterSection,
    attachmentsIndexSection,
  ];

  const packetSections =
    input.packetType === "disciplinary_packet"
      ? [...baseSections, ...disciplinarySections]
      : input.packetType === "hearing_packet"
        ? [...baseSections, ...hearingSections]
        : [...baseSections, ...employeeFileSections];

  const rendered = await renderPdf(supabase, {
    company,
    employee,
    documentTitle:
      input.packetType === "disciplinary_packet"
        ? "Disciplinary Packet"
        : input.packetType === "hearing_packet"
          ? "Hearing Packet"
          : "Employee HR File",
    documentNumber: toDocumentNumber("employee_documents", input.employeeId),
    versionNumber: 1,
    generatedBy: input.generatedBy,
    sections: packetSections,
  });

  const documentsIncluded = documents.map((doc: any) => ({
    source_table: asText(doc.source_table),
    source_document_id: asText(doc.source_document_id),
    version_number: safeVersion(doc.version_number || 1),
  }));

  const saved = await saveExportRecord(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    packetType: input.packetType,
    exportKind: "packet",
    fileName: `${input.packetType}-${employeeName(employee).replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
    pdfBytes: rendered.bytes,
    createdBy: input.generatedBy,
    documentsIncluded,
    pageCount: rendered.pageCount,
    metadata: {
      warningsCount: warnings.length,
      hearingsCount: hearings.length,
      timelineCount: timeline.length,
      notesCount: notes.length,
      participantCount: participants.length,
      evidenceCount: evidence.length,
    },
    hrCaseId: input.hrCaseId || null,
    hearingCaseId: input.hearingCaseId || null,
  });

  return {
    ...saved,
    pageCount: rendered.pageCount,
    documentsIncluded,
  };
}
