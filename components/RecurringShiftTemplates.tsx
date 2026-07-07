"use client";

import React, { useMemo, useState } from "react";

type ShiftTemplateRow = {
  id: string;
  template_name: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  recurring_pattern: string | null;
  rotation_group: string | null;
  status: string;
};

type StoreLite = {
  id: string;
  name: string;
};

type EmployeeLite = {
  id: string;
  first_name: string;
  last_name: string;
};

export default function RecurringShiftTemplates({
  templates,
  stores,
  employees,
  onCreateTemplate,
  onApplyTemplate,
}: {
  templates: ShiftTemplateRow[];
  stores: StoreLite[];
  employees: EmployeeLite[];
  onCreateTemplate?: (payload: {
    template_name: string;
    shift_type: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    recurring_pattern: string;
    rotation_group: string | null;
  }) => Promise<void> | void;
  onApplyTemplate?: (payload: {
    templateId: string;
    storeId: string;
    employeeId: string;
    startDate: string;
    endDate: string;
  }) => Promise<void> | void;
}) {
  const [templateName, setTemplateName] = useState("Early Shift");
  const [shiftType, setShiftType] = useState("morning");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [breakMinutes, setBreakMinutes] = useState("30");
  const [pattern, setPattern] = useState("weekly");
  const [rotation, setRotation] = useState("");

  const [templateId, setTemplateId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  const activeTemplates = useMemo(() => templates.filter((item) => item.status !== "inactive"), [templates]);

  return (
    <section className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
      <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-700">Shift Templates</div>
      <h3 className="mt-2 text-2xl font-black text-slate-950">Recurring Patterns and Rotations</h3>
      <p className="mt-2 text-sm text-slate-500">Create and apply recurring templates to existing roster shifts for faster planning.</p>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-black text-slate-900">Create Template</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="Template name" />
            <input value={shiftType} onChange={(event) => setShiftType(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="Shift type" />
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
            <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
            <input value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="Break minutes" />
            <input value={pattern} onChange={(event) => setPattern(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" placeholder="Pattern" />
            <input value={rotation} onChange={(event) => setRotation(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold md:col-span-2" placeholder="Rotation group (optional)" />
          </div>
          <button
            onClick={() =>
              onCreateTemplate?.({
                template_name: templateName,
                shift_type: shiftType,
                start_time: startTime,
                end_time: endTime,
                break_minutes: Number(breakMinutes || 0),
                recurring_pattern: pattern,
                rotation_group: rotation || null,
              })
            }
            className="mt-4 rounded-xl bg-[#06101f] px-4 py-2 text-sm font-black text-cyan-300"
          >
            Save Template
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-black text-slate-900">Apply Template</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold md:col-span-2">
              <option value="">Select template</option>
              {activeTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.template_name}</option>
              ))}
            </select>

            <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold">
              <option value="">Select store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>

            <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold">
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>
              ))}
            </select>

            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" />
          </div>
          <button
            onClick={() =>
              onApplyTemplate?.({
                templateId,
                storeId,
                employeeId,
                startDate,
                endDate,
              })
            }
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white"
          >
            Apply to Date Range
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {activeTemplates.slice(0, 9).map((template) => (
          <div key={template.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <div className="font-black text-slate-900">{template.template_name}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">
              {template.start_time.slice(0, 5)} - {template.end_time.slice(0, 5)} · {template.shift_type}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
