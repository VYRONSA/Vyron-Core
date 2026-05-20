$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppLeaveApprovalActionPanel") {
  throw "Install the WhatsApp leave approve-and-send fix first."
}

$component = @'

function WhatsAppHrCaseActionPanel({
  hrCases,
  employees,
  onRefresh,
}: {
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  onRefresh?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const openCases = hrCases.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "resolved";
  });

  function findEmployee(hrCase: HrCaseRow) {
    const byId = employees.find((employee) => String(employee.id) === String(hrCase.employee_id || ""));
    if (byId) return byId;

    const caseName = String(hrCase.employee_name || "").trim().toLowerCase();

    return employees.find((employee) => {
      const displayName = getEmployeeDisplayName(employee).trim().toLowerCase();
      const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim().toLowerCase();
      return caseName && (displayName === caseName || fullName === caseName);
    }) || null;
  }

  async function resolveAndSend(hrCase: HrCaseRow, resolution: "resolved" | "closed") {
    setBusyId(hrCase.id);
    setResultText(null);
    setErrorText(null);

    const feedback = feedbackById[hrCase.id] || "";
    const employee = findEmployee(hrCase);
    const employeeName =
      hrCase.employee_name ||
      (employee ? getEmployeeDisplayName(employee) : "Employee");

    try {
      const { error: updateError } = await supabase
        .from("hr_cases")
        .update({
          status: resolution,
          manager_feedback: feedback.trim() || "Case reviewed by management.",
        })
        .eq("id", hrCase.id);

      if (updateError) {
        setErrorText(updateError.message);
        setBusyId(null);
        return;
      }

      const phone = employee?.phone || "";

      if (!phone) {
        setResultText(`HR case ${resolution}. WhatsApp skipped because no phone number is saved for ${employeeName}.`);
        setBusyId(null);
        if (onRefresh) onRefresh();
        return;
      }

      const message = `Hi ${employeeName}, your HR case "${hrCase.case_type || "HR Case"}" has been reviewed by management.${feedback ? ` Feedback: ${feedback}` : ""} Regards, VYRON CORE.`;

      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: phone,
          message,
          employeeName,
          type: "hr_case_resolution",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setErrorText(`HR case updated, but WhatsApp failed: ${data.error || "Unknown WhatsApp error."}`);
        setBusyId(null);
        if (onRefresh) onRefresh();
        return;
      }

      setResultText(`HR case updated and WhatsApp sent to ${employeeName}.`);
      setBusyId(null);

      if (onRefresh) onRefresh();
    } catch (error: any) {
      setErrorText(error?.message || "HR case action failed.");
      setBusyId(null);
    }
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">HR case + WhatsApp actions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Resolve HR cases and notify employees in one action.
          </p>
        </div>

        <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm font-black text-rose-700">
          {openCases.length} HR action(s)
        </div>
      </div>

      {resultText && <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{resultText}</div>}
      {errorText && <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{errorText}</div>}

      <div className="mt-6 grid gap-4">
        {openCases.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
            No open HR cases.
          </div>
        ) : (
          openCases.map((hrCase) => {
            const employee = findEmployee(hrCase);
            const employeeName =
              hrCase.employee_name ||
              (employee ? getEmployeeDisplayName(employee) : "Employee");
            const phone = employee?.phone || "";

            return (
              <div key={hrCase.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{employeeName}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {hrCase.case_type || "HR Case"}
                    </div>

                    <div className="mt-2 text-xs font-bold text-slate-400">
                      Phone: {phone || "No phone number saved"}
                    </div>

                    {hrCase.description && (
                      <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                        {hrCase.description}
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-xl">
                    <label className="text-sm font-bold">
                      Manager feedback
                      <textarea
                        value={feedbackById[hrCase.id] || ""}
                        onChange={(event) =>
                          setFeedbackById((current) => ({
                            ...current,
                            [hrCase.id]: event.target.value,
                          }))
                        }
                        className="mt-2 min-h-24 w-full rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
                        placeholder="Optional feedback to include in WhatsApp..."
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => resolveAndSend(hrCase, "resolved")}
                        disabled={busyId === hrCase.id}
                        className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busyId === hrCase.id ? "Working..." : "Resolve + Send WhatsApp"}
                      </button>

                      <button
                        type="button"
                        onClick={() => resolveAndSend(hrCase, "closed")}
                        disabled={busyId === hrCase.id}
                        className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busyId === hrCase.id ? "Working..." : "Close + Send WhatsApp"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

'@

if ($content -notmatch "function WhatsAppHrCaseActionPanel") {
  $content = $content.Replace(
    "`nfunction WhatsAppLeaveApprovalActionPanel",
    "`n$component`nfunction WhatsAppLeaveApprovalActionPanel"
  )
}

if ($content -notmatch "<WhatsAppHrCaseActionPanel") {
  $content = $content.Replace(
    '<WhatsAppLeaveApprovalActionPanel leaveRequests={leaveRequests} employees={employees} onRefresh={onRefresh} />',
    '<WhatsAppLeaveApprovalActionPanel leaveRequests={leaveRequests} employees={employees} onRefresh={onRefresh} />' + "`r`n`r`n" +
    '<WhatsAppHrCaseActionPanel hrCases={hrCases} employees={employees} onRefresh={onRefresh} />'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "HR case WhatsApp actions installed."
Write-Host ""
Write-Host "Now available:"
Write-Host "- Resolve + Send WhatsApp"
Write-Host "- Close + Send WhatsApp"
Write-Host "- Updates hr_cases.status"
Write-Host "- Saves manager feedback"
Write-Host "- Sends WhatsApp"
Write-Host "- Refreshes live data"
