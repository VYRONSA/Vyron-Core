"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, RefreshCcw, Save } from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string | null;
};

type SkillRow = { id: string; skill_name: string; category: string | null };
type EmployeeSkillRow = {
  id: string;
  employee_id: string;
  skill_id: string;
  proficiency: number;
  certified: boolean;
};
type DocumentRow = {
  id: string;
  employee_id: string;
  document_type: string;
  document_title: string;
  expiry_date: string | null;
  status: string;
};
type AssetRow = { id: string; name: string; asset_code: string | null };
type AssetAssignRow = {
  id: string;
  employee_id: string;
  asset_id: string | null;
  assignment_type: string;
  issued_date: string;
  due_return_date: string | null;
  status: string;
};
type ProbationRow = {
  id: string;
  employee_id: string;
  probation_start_date: string;
  probation_end_date: string;
  status: string;
};
type EventRow = {
  id: string;
  employee_id: string;
  event_type: string;
  effective_date: string;
  from_value: string | null;
  to_value: string | null;
};
type TagRow = { id: string; tag_name: string; color: string | null };
type TagLinkRow = { id: string; employee_id: string; tag_id: string };
type CustomFieldRow = {
  id: string;
  field_key: string;
  field_label: string;
  field_type: string;
};
type CustomFieldValueRow = {
  id: string;
  employee_id: string;
  field_id: string;
  value_text: string | null;
};
type NoteRow = {
  id: string;
  employee_id: string;
  note_body: string;
  visibility: string;
  created_at: string;
};

function labelEmployee(employee: EmployeeRow | undefined) {
  if (!employee) return "Unknown employee";
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function isSchemaMissing(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205";
}

export default function EmployeeEnterpriseEnhancementsPanel() {
  const [companyId, setCompanyId] = useState("");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [employeeSkills, setEmployeeSkills] = useState<EmployeeSkillRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetAssignments, setAssetAssignments] = useState<AssetAssignRow[]>([]);
  const [probationRows, setProbationRows] = useState<ProbationRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagLinks, setTagLinks] = useState<TagLinkRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [schemaNotice, setSchemaNotice] = useState("");

  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCategory, setNewSkillCategory] = useState("general");
  const [skillId, setSkillId] = useState("");
  const [skillProficiency, setSkillProficiency] = useState("50");
  const [skillCertified, setSkillCertified] = useState(false);

  const [assetId, setAssetId] = useState("");
  const [assignmentType, setAssignmentType] = useState("equipment");
  const [assignmentDueDate, setAssignmentDueDate] = useState("");

  const [probationStart, setProbationStart] = useState("");
  const [probationEnd, setProbationEnd] = useState("");

  const [eventType, setEventType] = useState("promotion");
  const [eventDate, setEventDate] = useState("");
  const [eventFromValue, setEventFromValue] = useState("");
  const [eventToValue, setEventToValue] = useState("");

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#0ea5e9");
  const [tagId, setTagId] = useState("");

  const [customFieldKey, setCustomFieldKey] = useState("");
  const [customFieldLabel, setCustomFieldLabel] = useState("");
  const [customFieldType, setCustomFieldType] = useState("text");
  const [customFieldId, setCustomFieldId] = useState("");
  const [customFieldValue, setCustomFieldValue] = useState("");

  const [noteBody, setNoteBody] = useState("");

  const employeeMap = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const skillMap = useMemo(() => {
    const map = new Map<string, SkillRow>();
    skills.forEach((skill) => map.set(skill.id, skill));
    return map;
  }, [skills]);

  const assetMap = useMemo(() => {
    const map = new Map<string, AssetRow>();
    assets.forEach((asset) => map.set(asset.id, asset));
    return map;
  }, [assets]);

  const selectedEmployeeSkills = useMemo(
    () => employeeSkills.filter((item) => item.employee_id === selectedEmployeeId),
    [employeeSkills, selectedEmployeeId]
  );

  const selectedEmployeeAssignments = useMemo(
    () => assetAssignments.filter((item) => item.employee_id === selectedEmployeeId),
    [assetAssignments, selectedEmployeeId]
  );

  const selectedEmployeeProbations = useMemo(
    () => probationRows.filter((item) => item.employee_id === selectedEmployeeId),
    [probationRows, selectedEmployeeId]
  );

  const selectedEmployeeEvents = useMemo(
    () => events.filter((item) => item.employee_id === selectedEmployeeId),
    [events, selectedEmployeeId]
  );

  const selectedEmployeeNotes = useMemo(
    () => notes.filter((item) => item.employee_id === selectedEmployeeId),
    [notes, selectedEmployeeId]
  );

  const selectedEmployeeTagLinks = useMemo(
    () => tagLinks.filter((item) => item.employee_id === selectedEmployeeId),
    [tagLinks, selectedEmployeeId]
  );

  const selectedEmployeeCustomValues = useMemo(
    () => customFieldValues.filter((item) => item.employee_id === selectedEmployeeId),
    [customFieldValues, selectedEmployeeId]
  );

  const expiringDocuments = useMemo(() => {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + 60);
    return documents
      .filter((item) => item.employee_id === selectedEmployeeId)
      .filter((item) => item.expiry_date)
      .filter((item) => new Date(String(item.expiry_date)) <= threshold)
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  }, [documents, selectedEmployeeId]);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError("");
    const { access, error: accessError } = await getCompanyAccess(supabase);
    if (accessError || !access?.company_id) {
      setError(accessError || "No company access.");
      setLoading(false);
      return;
    }
    setCompanyId(access.company_id);
    await loadData(access.company_id);
  }

  async function loadData(activeCompanyId: string) {
    setLoading(true);
    setSchemaNotice("");

    const results = await Promise.all([
      supabase
        .from("employees")
        .select("id,first_name,last_name,employee_number")
        .eq("company_id", activeCompanyId)
        .order("first_name", { ascending: true }),
      supabase.from("skills_registry").select("id,skill_name,category").eq("company_id", activeCompanyId),
      supabase.from("employee_skills").select("id,employee_id,skill_id,proficiency,certified").eq("company_id", activeCompanyId),
      supabase
        .from("employee_documents")
        .select("id,employee_id,document_type,document_title,expiry_date,status")
        .eq("company_id", activeCompanyId),
      supabase.from("field_assets").select("id,name,asset_code").eq("company_id", activeCompanyId),
      supabase
        .from("employee_asset_assignments")
        .select("id,employee_id,asset_id,assignment_type,issued_date,due_return_date,status")
        .eq("company_id", activeCompanyId),
      supabase
        .from("employee_probation_records")
        .select("id,employee_id,probation_start_date,probation_end_date,status")
        .eq("company_id", activeCompanyId),
      supabase
        .from("employee_employment_events")
        .select("id,employee_id,event_type,effective_date,from_value,to_value")
        .eq("company_id", activeCompanyId)
        .order("effective_date", { ascending: false }),
      supabase.from("employee_tags").select("id,tag_name,color").eq("company_id", activeCompanyId),
      supabase.from("employee_tag_links").select("id,employee_id,tag_id").eq("company_id", activeCompanyId),
      supabase
        .from("employee_custom_fields")
        .select("id,field_key,field_label,field_type")
        .eq("company_id", activeCompanyId),
      supabase
        .from("employee_custom_field_values")
        .select("id,employee_id,field_id,value_text")
        .eq("company_id", activeCompanyId),
      supabase
        .from("employee_notes")
        .select("id,employee_id,note_body,visibility,created_at")
        .eq("company_id", activeCompanyId)
        .order("created_at", { ascending: false }),
    ]);

    const [
      employeesResult,
      skillsResult,
      employeeSkillsResult,
      documentsResult,
      assetsResult,
      assignmentsResult,
      probationResult,
      eventsResult,
      tagsResult,
      tagLinksResult,
      customFieldsResult,
      customFieldValuesResult,
      notesResult,
    ] = results;

    const hardError = [employeesResult, skillsResult, employeeSkillsResult, documentsResult, assetsResult]
      .map((item) => item.error)
      .find((item) => item && !isSchemaMissing(item));

    if (hardError) {
      setError(hardError.message);
      setLoading(false);
      return;
    }

    const missingTables: string[] = [];
    if (isSchemaMissing(assignmentsResult.error)) missingTables.push("employee_asset_assignments");
    if (isSchemaMissing(probationResult.error)) missingTables.push("employee_probation_records");
    if (isSchemaMissing(eventsResult.error)) missingTables.push("employee_employment_events");
    if (isSchemaMissing(tagsResult.error)) missingTables.push("employee_tags");
    if (isSchemaMissing(tagLinksResult.error)) missingTables.push("employee_tag_links");
    if (isSchemaMissing(customFieldsResult.error)) missingTables.push("employee_custom_fields");
    if (isSchemaMissing(customFieldValuesResult.error)) missingTables.push("employee_custom_field_values");
    if (isSchemaMissing(notesResult.error)) missingTables.push("employee_notes");
    if (missingTables.length > 0) {
      setSchemaNotice(
        `Run sql/043-employee-enterprise-enhancements.sql to enable: ${missingTables.join(", ")}`
      );
    }

    const loadedEmployees = (employeesResult.data || []) as EmployeeRow[];
    setEmployees(loadedEmployees);
    setSkills((skillsResult.data || []) as SkillRow[]);
    setEmployeeSkills((employeeSkillsResult.data || []) as EmployeeSkillRow[]);
    setDocuments((documentsResult.data || []) as DocumentRow[]);
    setAssets((assetsResult.data || []) as AssetRow[]);
    setAssetAssignments((assignmentsResult.data || []) as AssetAssignRow[]);
    setProbationRows((probationResult.data || []) as ProbationRow[]);
    setEvents((eventsResult.data || []) as EventRow[]);
    setTags((tagsResult.data || []) as TagRow[]);
    setTagLinks((tagLinksResult.data || []) as TagLinkRow[]);
    setCustomFields((customFieldsResult.data || []) as CustomFieldRow[]);
    setCustomFieldValues((customFieldValuesResult.data || []) as CustomFieldValueRow[]);
    setNotes((notesResult.data || []) as NoteRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  async function saveSkillMatrix() {
    if (!selectedEmployeeId) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      let workingSkillId = skillId;
      if (!workingSkillId && newSkillName.trim()) {
        const created = await supabase
          .from("skills_registry")
          .insert({
            company_id: companyId,
            skill_key: newSkillName.trim().toLowerCase().replace(/\s+/g, "_"),
            skill_name: newSkillName.trim(),
            category: newSkillCategory.trim() || "general",
          })
          .select("id")
          .single();
        if (created.error) throw new Error(created.error.message);
        workingSkillId = created.data.id;
      }

      if (!workingSkillId) throw new Error("Select or create a skill first.");

      const result = await supabase.from("employee_skills").upsert(
        {
          company_id: companyId,
          employee_id: selectedEmployeeId,
          skill_id: workingSkillId,
          proficiency: Math.max(0, Math.min(100, Number(skillProficiency || "0"))),
          certified: skillCertified,
        },
        { onConflict: "company_id,employee_id,skill_id" }
      );

      if (result.error) throw new Error(result.error.message);

      setMessage("Skills matrix updated.");
      setSkillId("");
      setNewSkillName("");
      await loadData(companyId);
    } catch (caught: any) {
      setError(caught?.message || "Could not save skills matrix.");
    }

    setSaving(false);
  }

  async function addAssetAssignment() {
    if (!selectedEmployeeId || !assetId) return;
    setSaving(true);
    setError("");
    setMessage("");

    const result = await supabase.from("employee_asset_assignments").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId,
      asset_id: assetId,
      assignment_type: assignmentType,
      issued_date: new Date().toISOString().slice(0, 10),
      due_return_date: assignmentDueDate || null,
      status: "issued",
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setMessage("Asset/PPE assignment captured.");
    setAssetId("");
    setAssignmentDueDate("");
    setSaving(false);
    await loadData(companyId);
  }

  async function addProbationRecord() {
    if (!selectedEmployeeId || !probationStart || !probationEnd) return;
    setSaving(true);
    setError("");
    setMessage("");

    const result = await supabase.from("employee_probation_records").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId,
      probation_start_date: probationStart,
      probation_end_date: probationEnd,
      status: "active",
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setMessage("Probation record saved.");
    setProbationStart("");
    setProbationEnd("");
    setSaving(false);
    await loadData(companyId);
  }

  async function addEmploymentEvent() {
    if (!selectedEmployeeId || !eventDate) return;
    setSaving(true);
    setError("");
    setMessage("");

    const result = await supabase.from("employee_employment_events").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId,
      event_type: eventType,
      effective_date: eventDate,
      from_value: eventFromValue || null,
      to_value: eventToValue || null,
      reason: eventType,
      notes: null,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setMessage("Employment timeline updated.");
    setEventFromValue("");
    setEventToValue("");
    setEventDate("");
    setSaving(false);
    await loadData(companyId);
  }

  async function createAndAssignTag() {
    if (!selectedEmployeeId) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      let workingTagId = tagId;
      if (!workingTagId && newTagName.trim()) {
        const created = await supabase
          .from("employee_tags")
          .insert({ company_id: companyId, tag_name: newTagName.trim(), color: newTagColor })
          .select("id")
          .single();
        if (created.error) throw new Error(created.error.message);
        workingTagId = created.data.id;
      }

      if (!workingTagId) throw new Error("Select or create a tag.");

      const linked = await supabase.from("employee_tag_links").upsert(
        {
          company_id: companyId,
          employee_id: selectedEmployeeId,
          tag_id: workingTagId,
        },
        { onConflict: "company_id,employee_id,tag_id" }
      );

      if (linked.error) throw new Error(linked.error.message);

      setMessage("Employee tags updated.");
      setTagId("");
      setNewTagName("");
      await loadData(companyId);
    } catch (caught: any) {
      setError(caught?.message || "Could not save tags.");
    }

    setSaving(false);
  }

  async function saveCustomFieldAndValue() {
    if (!selectedEmployeeId) return;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      let workingFieldId = customFieldId;
      if (!workingFieldId && customFieldKey.trim() && customFieldLabel.trim()) {
        const created = await supabase
          .from("employee_custom_fields")
          .insert({
            company_id: companyId,
            field_key: customFieldKey.trim().toLowerCase().replace(/\s+/g, "_"),
            field_label: customFieldLabel.trim(),
            field_type: customFieldType,
          })
          .select("id")
          .single();
        if (created.error) throw new Error(created.error.message);
        workingFieldId = created.data.id;
      }

      if (!workingFieldId) throw new Error("Select or create a custom field.");

      const saved = await supabase.from("employee_custom_field_values").upsert(
        {
          company_id: companyId,
          employee_id: selectedEmployeeId,
          field_id: workingFieldId,
          value_text: customFieldValue || null,
          value_json: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,employee_id,field_id" }
      );

      if (saved.error) throw new Error(saved.error.message);

      setMessage("Custom field value saved.");
      setCustomFieldValue("");
      setCustomFieldId("");
      setCustomFieldKey("");
      setCustomFieldLabel("");
      await loadData(companyId);
    } catch (caught: any) {
      setError(caught?.message || "Could not save custom field value.");
    }

    setSaving(false);
  }

  async function addNoteWithAudit() {
    if (!selectedEmployeeId || !noteBody.trim()) return;
    setSaving(true);
    setError("");
    setMessage("");

    const noteResult = await supabase.from("employee_notes").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId,
      note_body: noteBody.trim(),
      visibility: "internal",
      created_by: "employee-module",
    });

    if (noteResult.error) {
      setError(noteResult.error.message);
      setSaving(false);
      return;
    }

    await supabase.from("employee_audit_history").insert({
      company_id: companyId,
      employee_id: selectedEmployeeId,
      action: "note_added",
      details: { note_preview: noteBody.trim().slice(0, 120) },
      created_by: "employee-module",
    });

    setMessage("Employee note saved with audit trail entry.");
    setNoteBody("");
    setSaving(false);
    await loadData(companyId);
  }

  return (
    <section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Enterprise Enhancements</div>
          <h2 className="mt-2 text-3xl font-black text-slate-950">Employee Capability Layer</h2>
        </div>
        <button
          onClick={() => companyId && loadData(companyId)}
          className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-700 border border-slate-200"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-500">
        Skills matrix, certification expiry, PPE/equipment register, probation, timeline, tags, custom fields, and auditable notes.
      </p>

      {schemaNotice && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">{schemaNotice}</div>
      )}
      {error && (
        <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>
      )}
      {message && (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold">Employees: {employees.length}</div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold">Skills: {selectedEmployeeSkills.length}</div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold">Expiring docs: {expiringDocuments.length}</div>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold">Notes: {selectedEmployeeNotes.length}</div>
      </div>

      <label className="mt-5 block text-sm font-bold text-slate-800">
        Employee
        <select
          value={selectedEmployeeId}
          onChange={(event) => setSelectedEmployeeId(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        >
          <option value="">Select employee</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {labelEmployee(employee)} · {employee.employee_number || "No code"}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Skills Matrix</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={skillId} onChange={(event) => setSkillId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="">Select existing skill</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>{skill.skill_name}</option>
              ))}
            </select>
            <input value={newSkillName} onChange={(event) => setNewSkillName(event.target.value)} placeholder="Or create skill" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={newSkillCategory} onChange={(event) => setNewSkillCategory(event.target.value)} placeholder="Category" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={skillProficiency} onChange={(event) => setSkillProficiency(event.target.value.replace(/\D/g, ""))} placeholder="Proficiency 0-100" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={skillCertified} onChange={(event) => setSkillCertified(event.target.checked)} /> Certified
          </label>
          <button onClick={saveSkillMatrix} disabled={saving || !selectedEmployeeId} className="mt-3 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            <Save className="h-4 w-4" /> Save skill
          </button>

          <div className="mt-3 space-y-2">
            {selectedEmployeeSkills.map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                {(skillMap.get(item.skill_id)?.skill_name || "Unknown skill")} · {item.proficiency}% · {item.certified ? "Certified" : "Not certified"}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Licences & Certification Expiry</h3>
          <p className="mt-2 text-xs font-semibold text-slate-500">Tracked from employee_documents expiry_date.</p>
          <div className="mt-3 space-y-2 max-h-52 overflow-auto">
            {expiringDocuments.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-500">No upcoming expiries in next 60 days.</div>
            ) : (
              expiringDocuments.map((item) => (
                <div key={item.id} className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                  {item.document_title} ({item.document_type}) expiring {item.expiry_date}
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Uniform / PPE / Equipment Register</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="">Select asset</option>
              {assets.map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({item.asset_code || "no-code"})</option>
              ))}
            </select>
            <select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="equipment">Equipment</option>
              <option value="uniform">Uniform</option>
              <option value="ppe">PPE</option>
            </select>
            <input type="date" value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <button onClick={addAssetAssignment} disabled={saving || !selectedEmployeeId || !assetId} className="mt-3 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            <Plus className="h-4 w-4" /> Issue assignment
          </button>
          <div className="mt-3 space-y-2">
            {selectedEmployeeAssignments.map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                {(assetMap.get(item.asset_id || "")?.name || "Unknown asset")} · {item.assignment_type} · {item.status}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Probation + Employment Timeline</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="date" value={probationStart} onChange={(event) => setProbationStart(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input type="date" value={probationEnd} onChange={(event) => setProbationEnd(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <button onClick={addProbationRecord} disabled={saving || !selectedEmployeeId || !probationStart || !probationEnd} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            Save probation
          </button>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={eventType} onChange={(event) => setEventType(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="promotion">Promotion</option>
              <option value="salary_change">Salary change</option>
              <option value="position_change">Position change</option>
              <option value="status_change">Status change</option>
            </select>
            <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={eventFromValue} onChange={(event) => setEventFromValue(event.target.value)} placeholder="From value" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={eventToValue} onChange={(event) => setEventToValue(event.target.value)} placeholder="To value" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <button onClick={addEmploymentEvent} disabled={saving || !selectedEmployeeId || !eventDate} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            Save timeline event
          </button>

          <div className="mt-3 space-y-2">
            {selectedEmployeeProbations.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                Probation {item.probation_start_date} to {item.probation_end_date} · {item.status}
              </div>
            ))}
            {selectedEmployeeEvents.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                {item.event_type} · {item.effective_date} · {item.from_value || "-"} → {item.to_value || "-"}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Employee Tags</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={tagId} onChange={(event) => setTagId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="">Select existing tag</option>
              {tags.map((item) => (
                <option key={item.id} value={item.id}>{item.tag_name}</option>
              ))}
            </select>
            <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="Or create tag" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} placeholder="#0ea5e9" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <button onClick={createAndAssignTag} disabled={saving || !selectedEmployeeId} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            Save tag
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedEmployeeTagLinks.map((item) => {
              const tag = tags.find((row) => row.id === item.tag_id);
              return (
                <span key={item.id} className="rounded-full px-3 py-1 text-xs font-black text-white" style={{ background: tag?.color || "#0ea5e9" }}>
                  {tag?.tag_name || "Tag"}
                </span>
              );
            })}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-lg font-black text-slate-900">Custom Fields</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={customFieldId} onChange={(event) => setCustomFieldId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="">Select field</option>
              {customFields.map((item) => (
                <option key={item.id} value={item.id}>{item.field_label}</option>
              ))}
            </select>
            <input value={customFieldKey} onChange={(event) => setCustomFieldKey(event.target.value)} placeholder="new_field_key" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <input value={customFieldLabel} onChange={(event) => setCustomFieldLabel(event.target.value)} placeholder="New field label" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
            <select value={customFieldType} onChange={(event) => setCustomFieldType(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
            </select>
            <input value={customFieldValue} onChange={(event) => setCustomFieldValue(event.target.value)} placeholder="Field value" className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" />
          </div>
          <button onClick={saveCustomFieldAndValue} disabled={saving || !selectedEmployeeId} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
            Save custom field value
          </button>
          <div className="mt-3 space-y-2">
            {selectedEmployeeCustomValues.map((item) => {
              const field = customFields.find((row) => row.id === item.field_id);
              return (
                <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                  {field?.field_label || "Field"}: {item.value_text || "-"}
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <article className="mt-6 rounded-2xl border border-slate-200 p-4">
        <h3 className="text-lg font-black text-slate-900">Employee Notes With Audit Trail</h3>
        <textarea
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          rows={4}
          placeholder="Capture internal employee notes..."
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
        />
        <button onClick={addNoteWithAudit} disabled={saving || !selectedEmployeeId || !noteBody.trim()} className="mt-3 flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add note
        </button>
        <div className="mt-3 space-y-2 max-h-56 overflow-auto">
          {selectedEmployeeNotes.map((item) => (
            <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-700">
              <div>{item.note_body}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.visibility} · {new Date(item.created_at).toLocaleString("en-ZA")}</div>
            </div>
          ))}
          {!loading && selectedEmployeeNotes.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-500">No notes for this employee.</div>
          )}
        </div>
      </article>

      {loading && (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
          <RefreshCcw className="mr-2 inline h-4 w-4" /> Loading enterprise enhancements...
        </div>
      )}

      {!loading && (
        <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-xs font-semibold text-blue-900">
          <CheckCircle2 className="mr-2 inline h-4 w-4" /> Enterprise employee enhancement layer active.
          <span className="ml-2"><AlertTriangle className="mr-1 inline h-3 w-3" />Run SQL migrations 042 and 043 in Supabase before production verification.</span>
        </div>
      )}
    </section>
  );
}
