import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendTimelineEvent,
  safeAudit,
} from "@/lib/employee-relations-api";
import {
  createEmployeeDocument,
  replaceCurrentDocumentVersion,
} from "@/lib/employee-document-centre";
import { generateStructuredJson, getCentralAiModel } from "@/lib/centralized-ai-client";

export const AI_GENERATION_TYPES = [
  "hr_document",
  "verbal_warning",
  "written_warning",
  "final_written_warning",
  "counselling_record",
  "investigation_report",
  "hearing_notice",
  "suspension_letter",
  "hearing_outcome",
  "appeal_outcome",
  "dismissal_recommendation",
  "manager_notes",
  "witness_statements",
  "investigation_questions",
  "witness_questions",
  "hr_summary",
] as const;

export type AiGenerationType = (typeof AI_GENERATION_TYPES)[number];

export type StructuredAiDocumentOutput = {
  documentTitle: string;
  recommendedAction: string;
  reasoning: string;
  supportingHistory: string[];
  riskAssessment: string;
  suggestedNextStep: string;
  managerGuidance: string;
  hrGuidance: string;
  editableDocumentBody: string;
  confidenceScore: number;
};

type PromptRegistryRow = {
  prompt_key: string;
  prompt_version: number;
  prompt_template: string;
};

type ErContextPayload = {
  employee: Record<string, unknown> | null;
  employmentProfile: Record<string, unknown> | null;
  hrCases: Record<string, unknown>[];
  hrWarnings: Record<string, unknown>[];
  hearingCases: Record<string, unknown>[];
  employeeNotes: Record<string, unknown>[];
  timelineEvents: Record<string, unknown>[];
  progression: Record<string, unknown> | null;
  progressionDecision: Record<string, unknown> | null;
  policyConfig: Record<string, unknown> | null;
};

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function clampConfidence(value: unknown): number {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function mapDocumentTitle(type: AiGenerationType): string {
  if (type === "hr_document") return "HR Decision Draft";
  if (type === "verbal_warning") return "Verbal Warning";
  if (type === "written_warning") return "Written Warning";
  if (type === "final_written_warning") return "Final Written Warning";
  if (type === "counselling_record") return "Counselling Record";
  if (type === "investigation_report") return "Investigation Report";
  if (type === "hearing_notice") return "Hearing Notice";
  if (type === "suspension_letter") return "Suspension Letter";
  if (type === "hearing_outcome") return "Hearing Outcome";
  if (type === "appeal_outcome") return "Appeal Outcome";
  if (type === "dismissal_recommendation") return "Dismissal Recommendation";
  if (type === "manager_notes") return "Manager Guidance Notes";
  if (type === "witness_statements") return "Witness Statements";
  if (type === "investigation_questions") return "Investigation Questions";
  if (type === "witness_questions") return "Witness Interview Questions";
  return "HR Summary";
}

function buildOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "documentTitle",
      "recommendedAction",
      "reasoning",
      "supportingHistory",
      "riskAssessment",
      "suggestedNextStep",
      "managerGuidance",
      "hrGuidance",
      "editableDocumentBody",
      "confidenceScore",
    ],
    properties: {
      documentTitle: { type: "string" },
      recommendedAction: { type: "string" },
      reasoning: { type: "string" },
      supportingHistory: {
        type: "array",
        items: { type: "string" },
      },
      riskAssessment: { type: "string" },
      suggestedNextStep: { type: "string" },
      managerGuidance: { type: "string" },
      hrGuidance: { type: "string" },
      editableDocumentBody: { type: "string" },
      confidenceScore: { type: "number" },
    },
  } as Record<string, unknown>;
}

function buildDefaultPromptTemplate(): string {
  return [
    "You are VYRON CORE Employee Relations Decision Engine.",
    "You generate structured operational HR decisions, not chat.",
    "Return only JSON that matches the schema exactly.",
    "Use measured business language and include actionable next steps.",
    "The editableDocumentBody must be a professional draft that HR can edit before saving.",
  ].join("\n");
}

async function loadPromptRegistry(
  supabase: SupabaseClient,
  companyId: string,
  promptKey: string
): Promise<PromptRegistryRow> {
  const query = supabase
    .from("ai_prompt_registry")
    .select("prompt_key,prompt_version,prompt_template")
    .eq("prompt_key", promptKey)
    .eq("active", true)
    .order("prompt_version", { ascending: false })
    .limit(1);

  const [companyScoped, globalScoped] = await Promise.all([
    query.eq("company_id", companyId).maybeSingle(),
    query.is("company_id", null).maybeSingle(),
  ]);

  if (companyScoped.data) {
    return companyScoped.data as PromptRegistryRow;
  }

  if (globalScoped.data) {
    return globalScoped.data as PromptRegistryRow;
  }

  return {
    prompt_key: promptKey,
    prompt_version: 1,
    prompt_template: buildDefaultPromptTemplate(),
  };
}

async function loadEmployeeRelationsContext(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  hrCaseId: string | null,
  hearingCaseId: string | null
): Promise<ErContextPayload> {
  const [
    employeeRes,
    profileRes,
    casesRes,
    warningsRes,
    hearingRes,
    notesRes,
    timelineRes,
    progressionRes,
    progressionDecisionRes,
    policyRes,
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id,employee_number,first_name,last_name,job_title,employment_type,email,phone,default_store_id")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle(),
    supabase
      .from("employee_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .maybeSingle(),
    supabase
      .from("hr_cases")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("hr_warnings")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("hearing_cases")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("employee_notes")
      .select("id,title,note,created_at,created_by")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("employee_relations_timeline_events")
      .select("id,event_type,event_date,title,summary,metadata")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("event_date", { ascending: false })
      .limit(50),
    supabase
      .from("discipline_progressions")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("discipline_progression_decisions")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("discipline_policy_configs")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!employeeRes.data) {
    throw new Error("Employee not found for AI generation context.");
  }

  const hrCases = (casesRes.data || []) as Record<string, unknown>[];
  const hearingCases = (hearingRes.data || []) as Record<string, unknown>[];

  const filteredCases = hrCaseId
    ? hrCases.filter((row) => asText(row.id) === hrCaseId)
    : hrCases;

  const filteredHearings = hearingCaseId
    ? hearingCases.filter((row) => asText(row.id) === hearingCaseId)
    : hearingCases;

  return {
    employee: (employeeRes.data || null) as Record<string, unknown> | null,
    employmentProfile: (profileRes.data || null) as Record<string, unknown> | null,
    hrCases: filteredCases,
    hrWarnings: (warningsRes.data || []) as Record<string, unknown>[],
    hearingCases: filteredHearings,
    employeeNotes: (notesRes.data || []) as Record<string, unknown>[],
    timelineEvents: (timelineRes.data || []) as Record<string, unknown>[],
    progression: (progressionRes.data || null) as Record<string, unknown> | null,
    progressionDecision: (progressionDecisionRes.data || null) as Record<string, unknown> | null,
    policyConfig: (policyRes.data || null) as Record<string, unknown> | null,
  };
}

function promptKeyForType(type: AiGenerationType): string {
  return `er_${type}`;
}

function buildUserPrompt(input: {
  generationType: AiGenerationType;
  context: ErContextPayload;
  additionalInstructions: string | null;
}): string {
  return [
    `Document Type: ${input.generationType}`,
    `Expected Default Title: ${mapDocumentTitle(input.generationType)}`,
    input.additionalInstructions ? `Additional Instructions: ${input.additionalInstructions}` : "",
    "Employee Relations Context JSON:",
    JSON.stringify(input.context),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateEmployeeRelationsAiDocument(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    employeeId: string;
    hrCaseId: string | null;
    hearingCaseId: string | null;
    generationType: AiGenerationType;
    additionalInstructions: string | null;
    actorEmail: string;
  }
): Promise<{
  generationId: string;
  promptKey: string;
  promptVersion: number;
  modelName: string;
  output: StructuredAiDocumentOutput;
}> {
  const contextPayload = await loadEmployeeRelationsContext(
    supabase,
    input.companyId,
    input.employeeId,
    input.hrCaseId,
    input.hearingCaseId
  );

  const promptKey = promptKeyForType(input.generationType);
  const promptRegistry = await loadPromptRegistry(supabase, input.companyId, promptKey);

  const model = getCentralAiModel();
  const startedAt = Date.now();
  const ai = await generateStructuredJson<StructuredAiDocumentOutput>({
    model,
    temperature: 0.2,
    schema: {
      name: "employee_relations_document",
      schema: buildOutputSchema(),
      strict: true,
    },
    messages: [
      {
        role: "system",
        content: promptRegistry.prompt_template,
      },
      {
        role: "user",
        content: buildUserPrompt({
          generationType: input.generationType,
          context: contextPayload,
          additionalInstructions: input.additionalInstructions,
        }),
      },
    ],
  });

  const output: StructuredAiDocumentOutput = {
    documentTitle: asText(ai.output.documentTitle) || mapDocumentTitle(input.generationType),
    recommendedAction: asText(ai.output.recommendedAction),
    reasoning: asText(ai.output.reasoning),
    supportingHistory: Array.isArray(ai.output.supportingHistory)
      ? ai.output.supportingHistory.map((entry) => asText(entry)).filter(Boolean)
      : [],
    riskAssessment: asText(ai.output.riskAssessment),
    suggestedNextStep: asText(ai.output.suggestedNextStep),
    managerGuidance: asText(ai.output.managerGuidance),
    hrGuidance: asText(ai.output.hrGuidance),
    editableDocumentBody: asText(ai.output.editableDocumentBody),
    confidenceScore: clampConfidence(ai.output.confidenceScore),
  };

  const inputPayload = {
    generationType: input.generationType,
    additionalInstructions: input.additionalInstructions,
    employeeId: input.employeeId,
    hrCaseId: input.hrCaseId,
    hearingCaseId: input.hearingCaseId,
    contextPayload,
  };

  const { data: created, error: createError } = await supabase
    .from("ai_document_generations")
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId,
      hr_case_id: input.hrCaseId,
      hearing_case_id: input.hearingCaseId,
      document_type: input.generationType,
      prompt_key: promptRegistry.prompt_key,
      prompt_version: promptRegistry.prompt_version,
      prompt_template_snapshot: promptRegistry.prompt_template,
      model_name: ai.model,
      model_version: "chat.completions",
      model_parameters: {
        temperature: 0.2,
      },
      input_payload: inputPayload,
      output_payload: output,
      confidence_score: output.confidenceScore,
      finalised: false,
      generation_status: "draft",
      created_by: input.actorEmail,
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    throw new Error("Could not persist AI document generation.");
  }

  await appendTimelineEvent(supabase, {
    companyId: input.companyId,
    employeeId: input.employeeId,
    eventType: "ai_document_generated",
    sourceTable: "ai_document_generations",
    sourceId: String(created.id),
    title: output.documentTitle,
    summary: `AI draft generated (${input.generationType}).`,
    metadata: {
      generationType: input.generationType,
      promptKey: promptRegistry.prompt_key,
      promptVersion: promptRegistry.prompt_version,
      model: ai.model,
      latencyMs: Date.now() - startedAt,
      usage: ai.usage,
    },
    createdBy: input.actorEmail,
  });

  await safeAudit(supabase, {
    companyId: input.companyId,
    email: input.actorEmail,
    action: "create",
    entityType: "ai_document_generation",
    entityId: String(created.id),
    metadata: {
      generationType: input.generationType,
      employeeId: input.employeeId,
      hrCaseId: input.hrCaseId,
      hearingCaseId: input.hearingCaseId,
      promptKey: promptRegistry.prompt_key,
      promptVersion: promptRegistry.prompt_version,
      model: ai.model,
    },
  });

  return {
    generationId: String(created.id),
    promptKey: promptRegistry.prompt_key,
    promptVersion: promptRegistry.prompt_version,
    modelName: ai.model,
    output,
  };
}

export async function saveReviewedAiGeneration(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    generationId: string;
    actorEmail: string;
    editedDocumentBody: string;
    editedTitle: string | null;
    reviewerNotes: string | null;
  }
): Promise<{ generationId: string; savedDocumentId: string; saveVersion: number }> {
  const { data: generation, error: generationError } = await supabase
    .from("ai_document_generations")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("id", input.generationId)
    .maybeSingle();

  if (generationError) {
    throw new Error("Could not load AI generation record.");
  }

  if (!generation) {
    throw new Error("AI generation not found.");
  }

  const employeeId = asText(generation.employee_id);
  if (!employeeId) {
    throw new Error("AI generation does not have a linked employee.");
  }

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id,first_name,last_name")
    .eq("company_id", input.companyId)
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeError || !employee) {
    throw new Error("Could not load employee for reviewed document save.");
  }

  const outputPayload = (generation.output_payload || {}) as Record<string, unknown>;
  const baseTitle = input.editedTitle || asText(outputPayload.documentTitle) || mapDocumentTitle("hr_document");
  const saveVersion = Number(generation.save_version || 0) + 1;
  const content = [
    `Title: ${baseTitle}`,
    `Document Type: ${asText(generation.document_type) || "hr_document"}`,
    `Generated At: ${asText(generation.created_at)}`,
    `Reviewed By: ${input.actorEmail}`,
    "",
    input.editedDocumentBody,
  ].join("\n");

  const fileBuffer = Buffer.from(content, "utf-8");
  const fileName = `${baseTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "") || "ai-review"}-v${saveVersion}.txt`;

  const existingSavedDocumentId = asText(generation.saved_document_id);
  let savedDocumentId = existingSavedDocumentId;

  if (existingSavedDocumentId) {
    await replaceCurrentDocumentVersion(supabase, {
      companyId: input.companyId,
      employeeId,
      sourceTable: "employee_documents",
      sourceDocumentId: existingSavedDocumentId,
      classification: "hr_document",
      fileName,
      mimeType: "text/plain",
      fileBuffer,
      actor: input.actorEmail,
      changeReason: "Reviewed AI document re-save",
    });
  } else {
    const created = await createEmployeeDocument(supabase, {
      companyId: input.companyId,
      employeeId,
      employeeName: `${asText(employee.first_name)} ${asText(employee.last_name)}`.trim(),
      documentType: asText(generation.document_type) || "hr_document",
      documentTitle: baseTitle,
      documentNotes: input.reviewerNotes,
      classification: "hr_document",
      fileName,
      mimeType: "text/plain",
      fileBuffer,
      actor: input.actorEmail,
      metadata: {
        source: "ai_generation_review",
        generationId: input.generationId,
      },
    });
    savedDocumentId = created.documentId;
  }

  const editedPayload = {
    ...(typeof generation.edited_payload === "object" && generation.edited_payload
      ? (generation.edited_payload as Record<string, unknown>)
      : {}),
    documentTitle: baseTitle,
    editableDocumentBody: input.editedDocumentBody,
    reviewerNotes: input.reviewerNotes,
    savedAt: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("ai_document_generations")
    .update({
      edited_payload: editedPayload,
      finalised: true,
      finalised_at: new Date().toISOString(),
      reviewed_by: input.actorEmail,
      reviewed_at: new Date().toISOString(),
      generation_status: "saved",
      saved_source_table: "employee_documents",
      saved_document_id: savedDocumentId,
      save_version: saveVersion,
    })
    .eq("id", input.generationId)
    .eq("company_id", input.companyId);

  if (updateError) {
    throw new Error("Could not update AI generation reviewed/save status.");
  }

  await Promise.allSettled([
    appendTimelineEvent(supabase, {
      companyId: input.companyId,
      employeeId,
      eventType: "ai_document_saved",
      sourceTable: "ai_document_generations",
      sourceId: input.generationId,
      title: baseTitle,
      summary: `AI document reviewed and saved (version ${saveVersion}).`,
      metadata: {
        savedDocumentId,
        saveVersion,
      },
      createdBy: input.actorEmail,
    }),
    safeAudit(supabase, {
      companyId: input.companyId,
      email: input.actorEmail,
      action: "update",
      entityType: "ai_document_generation",
      entityId: input.generationId,
      metadata: {
        state: "saved",
        saveVersion,
        savedDocumentId,
      },
    }),
  ]);

  return {
    generationId: input.generationId,
    savedDocumentId,
    saveVersion,
  };
}
