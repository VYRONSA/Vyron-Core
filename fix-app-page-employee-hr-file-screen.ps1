$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

if ($content -match "function\s+EmployeeHRFileScreen\s*\(") {
  Write-Host "EmployeeHRFileScreen already exists in app-page.tsx."
  exit 0
}

$screen = @'

function EmployeeHRFileScreen({
  employees,
  hrCases,
  hrWarnings,
  hrDocuments,
  hrNotes,
  leaveRequests,
  onRefresh,
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  hrWarnings: HrWarningRow[];
  hrDocuments: HrDocumentRow[];
  hrNotes: HrNoteRow[];
  leaveRequests: LeaveRequestRow[];
  authUserEmail?: string | null;
  onRefresh: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredEmployees = employees.filter((employee) => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) return true;

    return [
      employee.employee_number || "",
      employee.first_name || "",
      employee.last_name || "",
      employee.job_title || "",
      employee.email || "",
      employee.phone || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(search);
  });

  function localEmployeeName(employee: EmployeeRow) {
    return (
      `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
      employee.employee_number ||
      employee.email ||
      employee.phone ||
      "Unknown employee"
    );
  }

  return (
    <div className="space-y-6">
      <Panel dark>
        <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">
          Employee HR File
        </div>
        <h2 className="mt-3 text-3xl font-black tracking-tight">
          Employee HR records
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          View employee-linked HR cases, warnings, documents, notes and leave history.
        </p>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-2xl font-black tracking-tight text-slate-950">
              Employee Register
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Open each employee record to review HR activity.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search employees..."
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-cyan-400"
            />

            <button
              onClick={onRefresh}
              className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {filteredEmployees.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center xl:col-span-2">
              <div className="text-lg font-black text-slate-950">
                No employees found
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Employee HR files will appear here once employees are loaded.
              </p>
            </div>
          ) : (
            filteredEmployees.map((employee) => {
              const employeeKeys = [employee.id, employee.employee_number].filter(Boolean);

              const caseCount = hrCases.filter((item) =>
                employeeKeys.includes(item.employee_id)
              ).length;

              const warningCount = hrWarnings.filter((item) =>
                employeeKeys.includes(item.employee_id)
              ).length;

              const documentCount = hrDocuments.filter((item) =>
                employeeKeys.includes(item.employee_id)
              ).length;

              const noteCount = hrNotes.filter((item) =>
                employeeKeys.includes(item.employee_id)
              ).length;

              const leaveCount = leaveRequests.filter(
                (item) => item.employee_id && employeeKeys.includes(item.employee_id)
              ).length;

              return (
                <article
                  key={employee.id}
                  className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_16px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-xl font-black text-slate-950">
                        {localEmployeeName(employee)}
                      </h4>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {employee.employee_number || "No employee number"} ·{" "}
                        {employee.job_title || "No job title"}
                      </p>
                    </div>

                    <StatusPill value={employee.active ? "active" : "inactive"} />
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-5">
                    <InfoBox label="Cases" value={String(caseCount)} />
                    <InfoBox label="Warnings" value={String(warningCount)} />
                    <InfoBox label="Docs" value={String(documentCount)} />
                    <InfoBox label="Notes" value={String(noteCount)} />
                    <InfoBox label="Leave" value={String(leaveCount)} />
                  </div>
                </article>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

'@

$marker = "`n`nexport default function"

if ($content.Contains($marker)) {
  $content = $content.Replace($marker, "`n" + $screen + $marker)
} else {
  throw "Could not find export default function marker in app-page.tsx"
}

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host "Fixed missing EmployeeHRFileScreen in:"
Write-Host $filePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
