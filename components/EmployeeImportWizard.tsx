"use client";

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import {
	downloadStaffImportTemplate,
	parseStaffImportCsv,
	validateStaffImportRows,
	type StaffImportHeader,
} from "@/lib/staff-import";
import { supabase } from "@/lib/supabase";

type StoreRow = {
	id: string;
	name: string;
};

type ImportPreviewRow = {
	rowNumber: number;
	first_name: string;
	last_name: string;
	email: string;
	employee_number: string;
	job_title: string;
	store_branch: string;
	employment_type: string;
	phone: string;
};

type ImportErrorRow = {
	rowNumber: number;
	message: string;
};

const REQUIRED_HEADERS: StaffImportHeader[] = [
	"first_name",
	"last_name",
	"email",
	"employee_number",
	"job_title",
	"store_branch",
	"employment_type",
	"phone",
];

function normalizeHeader(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "");
}

function rowsToCsv(rows: Array<Record<string, string>>) {
	if (rows.length === 0) return "";
	const headers = Object.keys(rows[0]);
	const escape = (value: string) => `"${String(value || "").replaceAll('"', '""')}"`;
	const lines = [
		headers.join(","),
		...rows.map((row) => headers.map((header) => escape(String(row[header] || ""))).join(",")),
	];
	return lines.join("\n");
}

function downloadTextFile(content: string, fileName: string, type: string) {
	const blob = new Blob(["\uFEFF", content], { type });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.rel = "noopener";
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 200);
}

async function parseImportFile(file: File): Promise<ImportPreviewRow[]> {
	const lower = file.name.toLowerCase();

	if (lower.endsWith(".csv")) {
		const text = await file.text();
		const rows = parseStaffImportCsv(text);
		return rows.map((row, idx) => ({
			rowNumber: idx + 2,
			first_name: row.first_name || "",
			last_name: row.last_name || "",
			email: row.email || "",
			employee_number: row.employee_number || "",
			job_title: row.job_title || "",
			store_branch: row.store_branch || "",
			employment_type: row.employment_type || "",
			phone: row.phone || "",
		}));
	}

	if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
		const bytes = await file.arrayBuffer();
		const workbook = XLSX.read(bytes, { type: "array" });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
			header: 1,
			raw: false,
			blankrows: false,
		});

		if (matrix.length === 0) return [];

		const headerRow = matrix[0].map((cell) => normalizeHeader(String(cell || "")));
		const headerIndex = new Map<string, number>();
		headerRow.forEach((header, index) => {
			if (header) headerIndex.set(header, index);
		});

		const rows: ImportPreviewRow[] = [];
		for (let i = 1; i < matrix.length; i++) {
			const line = matrix[i];
			if (!line) continue;
			const get = (key: StaffImportHeader) => {
				const idx = headerIndex.get(key);
				return idx === undefined ? "" : String(line[idx] || "").trim();
			};
			rows.push({
				rowNumber: i + 1,
				first_name: get("first_name"),
				last_name: get("last_name"),
				email: get("email"),
				employee_number: get("employee_number"),
				job_title: get("job_title"),
				store_branch: get("store_branch"),
				employment_type: get("employment_type"),
				phone: get("phone"),
			});
		}

		return rows;
	}

	throw new Error("Unsupported file format. Upload CSV, XLSX, or XLS.");
}

export default function EmployeeImportWizard() {
	const [busy, setBusy] = useState<"validating" | "importing" | "exporting" | null>(null);
	const [fileName, setFileName] = useState<string>("");
	const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
	const [validationErrors, setValidationErrors] = useState<ImportErrorRow[]>([]);
	const [summary, setSummary] = useState<string>("");
	const [message, setMessage] = useState<string>("");
	const [error, setError] = useState<string>("");

	const canImport = useMemo(
		() => previewRows.length > 0 && validationErrors.length === 0,
		[previewRows.length, validationErrors.length]
	);

	async function validateAndPreview(file: File) {
		setBusy("validating");
		setError("");
		setMessage("");
		setSummary("");
		setValidationErrors([]);
		setPreviewRows([]);

		try {
			const { access, error: accessError } = await getCompanyAccess(supabase);
			if (accessError || !access?.company_id) {
				throw new Error(accessError || "No company access.");
			}

			const rows = await parseImportFile(file);
			if (rows.length === 0) {
				throw new Error("The file is empty.");
			}

			const [storesResult, existingResult] = await Promise.all([
				supabase.from("stores").select("id,name").eq("company_id", access.company_id),
				supabase
					.from("employees")
					.select("employee_number,email")
					.eq("company_id", access.company_id),
			]);

			if (storesResult.error) throw new Error(storesResult.error.message);
			if (existingResult.error) throw new Error(existingResult.error.message);

			const validation = validateStaffImportRows(
				rows.map((row) => ({
					first_name: row.first_name,
					last_name: row.last_name,
					email: row.email,
					employee_number: row.employee_number,
					job_title: row.job_title,
					store_branch: row.store_branch,
					employment_type: row.employment_type,
					phone: row.phone,
				})),
				{
					companyId: access.company_id,
					stores: (storesResult.data || []) as StoreRow[],
					employeeCap: null,
					currentActiveCount: 0,
					skipEmployeeLimit: true,
				}
			);

			const duplicateErrors: ImportErrorRow[] = [];
			const existingNumbers = new Set(
				(existingResult.data || [])
					.map((item) => String(item.employee_number || "").trim().toLowerCase())
					.filter(Boolean)
			);
			const existingEmails = new Set(
				(existingResult.data || [])
					.map((item) => String(item.email || "").trim().toLowerCase())
					.filter(Boolean)
			);

			rows.forEach((row, index) => {
				const rowNumber = row.rowNumber || index + 2;
				const empNo = String(row.employee_number || "").trim().toLowerCase();
				const email = String(row.email || "").trim().toLowerCase();

				if (empNo && existingNumbers.has(empNo)) {
					duplicateErrors.push({
						rowNumber,
						message: `Employee number already exists: ${row.employee_number}`,
					});
				}

				if (email && existingEmails.has(email)) {
					duplicateErrors.push({
						rowNumber,
						message: `Email already exists: ${row.email}`,
					});
				}
			});

			const allErrors = [...validation.errors, ...duplicateErrors].sort(
				(a, b) => a.rowNumber - b.rowNumber
			);

			setFileName(file.name);
			setPreviewRows(rows);
			setValidationErrors(allErrors);
			setSummary(
				`Rows: ${rows.length} | Valid: ${Math.max(0, rows.length - allErrors.length)} | Errors: ${allErrors.length}`
			);

			if (allErrors.length === 0) {
				setMessage("Validation passed. Ready to import.");
			}
		} catch (caught: any) {
			setError(caught?.message || "Validation failed.");
		}

		setBusy(null);
	}

	async function runImport() {
		if (!canImport) return;

		setBusy("importing");
		setError("");
		setMessage("");

		try {
			const { access, error: accessError } = await getCompanyAccess(supabase);
			if (accessError || !access?.company_id) {
				throw new Error(accessError || "No company access.");
			}

			const storesResult = await supabase.from("stores").select("id,name").eq("company_id", access.company_id);
			if (storesResult.error) throw new Error(storesResult.error.message);

			const validation = validateStaffImportRows(
				previewRows.map((row) => ({
					first_name: row.first_name,
					last_name: row.last_name,
					email: row.email,
					employee_number: row.employee_number,
					job_title: row.job_title,
					store_branch: row.store_branch,
					employment_type: row.employment_type,
					phone: row.phone,
				})),
				{
					companyId: access.company_id,
					stores: (storesResult.data || []) as StoreRow[],
					employeeCap: null,
					currentActiveCount: 0,
					skipEmployeeLimit: true,
				}
			);

			if (validation.errors.length > 0) {
				setValidationErrors(validation.errors);
				throw new Error("Import stopped due to validation errors.");
			}

			const payloads = validation.prepared.map((row) => ({
				...row.payload,
				pin_code: null,
				kiosk_access_enabled: true,
			}));

			if (payloads.length === 0) {
				throw new Error("No valid rows to import.");
			}

			const chunkSize = 200;
			for (let i = 0; i < payloads.length; i += chunkSize) {
				const chunk = payloads.slice(i, i + chunkSize);
				const { error: insertError } = await supabase.from("employees").insert(chunk);
				if (insertError) throw new Error(insertError.message);
			}

			setMessage(`Import complete. ${payloads.length} employee record(s) inserted.`);
			setSummary(
				`Imported ${payloads.length} of ${previewRows.length} from ${fileName || "uploaded file"}.`
			);
		} catch (caught: any) {
			setError(caught?.message || "Import failed.");
		}

		setBusy(null);
	}

	async function exportEmployees() {
		setBusy("exporting");
		setError("");
		setMessage("");

		try {
			const { access, error: accessError } = await getCompanyAccess(supabase);
			if (accessError || !access?.company_id) {
				throw new Error(accessError || "No company access.");
			}

			const result = await supabase
				.from("employees")
				.select(
					"employee_number,first_name,last_name,email,phone,job_title,employment_type,active,default_store_id"
				)
				.eq("company_id", access.company_id)
				.order("first_name", { ascending: true });

			if (result.error) throw new Error(result.error.message);

			const rows = (result.data || []).map((employee) => ({
				employee_number: String(employee.employee_number || ""),
				first_name: String(employee.first_name || ""),
				last_name: String(employee.last_name || ""),
				email: String(employee.email || ""),
				phone: String(employee.phone || ""),
				job_title: String(employee.job_title || ""),
				employment_type: String(employee.employment_type || ""),
				status: employee.active === false ? "inactive" : "active",
				default_store_id: String(employee.default_store_id || ""),
			}));

			downloadTextFile(
				rowsToCsv(rows),
				`vyron-employee-export-${new Date().toISOString().slice(0, 10)}.csv`,
				"text/csv;charset=utf-8;"
			);
			setMessage(`Export complete. ${rows.length} employee row(s) downloaded.`);
		} catch (caught: any) {
			setError(caught?.message || "Export failed.");
		}

		setBusy(null);
	}

	function downloadErrorReport() {
		if (validationErrors.length === 0) return;
		const rows = validationErrors.map((item) => ({
			row_number: String(item.rowNumber),
			error: item.message,
		}));
		downloadTextFile(rowsToCsv(rows), "vyron-employee-import-errors.csv", "text/csv;charset=utf-8;");
	}

	return (
		<section className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
			<div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">
				Employee Import / Export
			</div>
			<h2 className="mt-2 text-3xl font-black text-slate-950">Bulk Staff Data Flow</h2>
			<p className="mt-2 text-sm leading-6 text-slate-500">
				Supports Excel and CSV import with validation, duplicate detection, error reports, and export.
			</p>

			<div className="mt-6 grid gap-3 md:grid-cols-4">
				<button
					onClick={downloadStaffImportTemplate}
					className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700"
				>
					<Download className="h-4 w-4" />
					Template Download
				</button>

				<label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
					<UploadCloud className="h-4 w-4" />
					{busy === "validating" ? "Validating..." : "Upload CSV/XLSX"}
					<input
						type="file"
						accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (file) void validateAndPreview(file);
						}}
					/>
				</label>

				<button
					onClick={runImport}
					disabled={!canImport || busy === "importing"}
					className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
				>
					{busy === "importing" ? "Importing..." : "Run Import"}
				</button>

				<button
					onClick={exportEmployees}
					disabled={busy === "exporting"}
					className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700"
				>
					<FileSpreadsheet className="h-4 w-4" />
					{busy === "exporting" ? "Exporting..." : "Employee Export"}
				</button>
			</div>

			{summary && (
				<div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">{summary}</div>
			)}

			{message && (
				<div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
					{message}
				</div>
			)}

			{error && (
				<div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>
			)}

			{validationErrors.length > 0 && (
				<div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm font-black text-rose-700">
							Import validation failed with {validationErrors.length} issue(s)
						</div>
						<button
							onClick={downloadErrorReport}
							className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-700"
						>
							Download Error Report
						</button>
					</div>
					<div className="mt-3 max-h-44 space-y-2 overflow-auto">
						{validationErrors.slice(0, 120).map((item, idx) => (
							<div key={`${item.rowNumber}-${idx}`} className="rounded-xl bg-white p-3 text-xs font-semibold text-rose-800">
								Row {item.rowNumber}: {item.message}
							</div>
						))}
					</div>
				</div>
			)}

			{previewRows.length > 0 && (
				<div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
					<div className="text-sm font-black text-slate-800">Import Preview: {fileName || "uploaded file"}</div>
					<div className="mt-3 max-h-64 overflow-auto rounded-2xl bg-white">
						<table className="min-w-full text-left text-xs">
							<thead className="sticky top-0 bg-slate-100 text-slate-700">
								<tr>
									{REQUIRED_HEADERS.map((header) => (
										<th key={header} className="px-3 py-2 font-black uppercase tracking-[0.12em]">
											{header.replaceAll("_", " ")}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{previewRows.slice(0, 300).map((row) => (
									<tr key={row.rowNumber} className="border-t border-slate-100 text-slate-700">
										<td className="px-3 py-2">{row.first_name}</td>
										<td className="px-3 py-2">{row.last_name}</td>
										<td className="px-3 py-2">{row.email}</td>
										<td className="px-3 py-2">{row.employee_number}</td>
										<td className="px-3 py-2">{row.job_title}</td>
										<td className="px-3 py-2">{row.store_branch}</td>
										<td className="px-3 py-2">{row.employment_type}</td>
										<td className="px-3 py-2">{row.phone}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</section>
	);
}
