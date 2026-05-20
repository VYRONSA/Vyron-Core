$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppActionCentreLive") {
  throw "WhatsAppActionCentreLive not found. Please upload your current page.tsx if this happens."
}

$component = @'

function WhatsAppLeaveApprovalActionPanel({
  leaveRequests,
  employees,
  onRefresh,
}: {
  leaveRequests: LeaveRequestRow[];
  employees: EmployeeRow[];
  onRefresh?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");

  function findEmployee(leaveRequest: LeaveRequestRow) {
    const byId = employees.find((employee) => String(employee.id) === String(leaveRequest.employee_id || ""));
    if (byId) return byId;

    const leaveName = String(leaveRequest.employee_name || "").trim().toLowerCase();

    return employees.find((employee) => {
      const displayName = getEmployeeDisplayName(employee).trim().toLowerCase();
      const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim().toLowerCase();
      return leaveName && (displayName === leaveName || fullName === leaveName);
    }) || null;
  }

  async function approveOrDeclineAndSend(leaveRequest: LeaveRequestRow, decision: "approved" | "declined") {
    setBusyId(leaveRequest.id);
    setResultText(null);
    setErrorText(null);

    const feedback = feedbackById[leaveRequest.id] || "";
    const employee = findEmployee(leaveRequest);
    const employeeName =
      leaveRequest.employee_name ||
      (employee ? getEmployeeDisplayName(employee) : "Employee");

    try {
      const { error: updateError } = await supabase
        .from("leave_requests")
        .update({
          status: decision,
          manager_feedback: feedback.trim() || (decision === "approved" ? "Approved." : "Declined."),
        })
        .eq("id", leaveRequest.id);

      if (updateError) {
        setErrorText(updateError.message);
        setBusyId(null);
        return;
      }

      const phone = employee?.phone || "";
      const dateRange = `${formatDate(leaveRequest.start_date)} to ${formatDate(leaveRequest.end_date)}`;

      if (!phone) {
        setResultText(`Leave ${decision}. WhatsApp skipped because no phone number is saved for ${employeeName}.`);
        setBusyId(null);
        if (onRefresh) onRefresh();
        return;
      }

      const message =
        decision === "approved"
          ? `Hi ${employeeName}, your leave request for ${dateRange} has been approved.${feedback ? ` Manager feedback: ${feedback}` : ""} Regards, VYRON CORE.`
          : `Hi ${employeeName}, your leave request for ${dateRange} has not been approved.${feedback ? ` Reason: ${feedback}` : " Please contact your manager for feedback."} Regards, VYRON CORE.`;

      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: phone,
          message,
          employeeName,
          type: `leave_${decision}`,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setErrorText(`Leave ${decision}, but WhatsApp failed: ${data.error || "Unknown WhatsApp error."}`);
        setBusyId(null);
        if (onRefresh) onRefresh();
        return;
      }

      setResultText(`Leave ${decision} and WhatsApp sent to ${employeeName}.`);
      setBusyId(null);
      if (onRefresh) onRefresh();
    } catch (error: any) {
      setErrorText(error?.message || "Leave action failed.");
      setBusyId(null);
    }
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Leave approval + WhatsApp actions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Approve or decline leave here and send the employee WhatsApp confirmation in the same action.
          </p>
        </div>

        <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm font-black text-rose-700">
          {pendingLeave.length} leave action(s)
        </div>
      </div>

      {resultText && <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{resultText}</div>}
      {errorText && <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{errorText}</div>}

      <div className="mt-6 grid gap-4">
        {pendingLeave.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
            No pending leave approvals.
          </div>
        ) : (
          pendingLeave.map((leaveRequest) => {
            const employee = findEmployee(leaveRequest);
            const employeeName =
              leaveRequest.employee_name ||
              (employee ? getEmployeeDisplayName(employee) : "Employee");
            const phone = employee?.phone || "";

            return (
              <div key={leaveRequest.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="text-lg font-black text-slate-950">{employeeName}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      {leaveRequest.leave_type || "Leave"} · {formatDate(leaveRequest.start_date)} to {formatDate(leaveRequest.end_date)}
                    </div>
                    <div className="mt-2 text-xs font-bold text-slate-400">
                      Phone: {phone || "No phone number saved"}
                    </div>
                    {leaveRequest.reason && (
                      <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                        Reason: {leaveRequest.reason}
                      </div>
                    )}
                  </div>

                  <div className="w-full max-w-xl">
                    <label className="text-sm font-bold">
                      Manager feedback
                      <textarea
                        value={feedbackById[leaveRequest.id] || ""}
                        onChange={(event) =>
                          setFeedbackById((current) => ({
                            ...current,
                            [leaveRequest.id]: event.target.value,
                          }))
                        }
                        className="mt-2 min-h-24 w-full rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
                        placeholder="Optional feedback to include in WhatsApp..."
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => approveOrDeclineAndSend(leaveRequest, "approved")}
                        disabled={busyId === leaveRequest.id}
                        className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busyId === leaveRequest.id ? "Working..." : "Approve + Send WhatsApp"}
                      </button>

                      <button
                        type="button"
                        onClick={() => approveOrDeclineAndSend(leaveRequest, "declined")}
                        disabled={busyId === leaveRequest.id}
                        className="rounded-2xl bg-rose-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                      >
                        {busyId === leaveRequest.id ? "Working..." : "Decline + Send WhatsApp"}
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

if ($content -notmatch "function WhatsAppLeaveApprovalActionPanel") {
  $content = $content.Replace("`nfunction WhatsAppActionCentreLive", "`n$component`nfunction WhatsAppActionCentreLive")
}

# Add onRefresh prop to WhatsAppActionCentreLive signature if not present.
$content = $content.Replace(
  'setActive,',
  'setActive,' + "`r`n" + '  onRefresh,',
  1
)

$content = $content.Replace(
  'setActive: (value: string) => void;',
  'setActive: (value: string) => void;' + "`r`n" + '  onRefresh?: () => void;',
  1
)

# Add panel near top of WhatsAppActionCentreLive if not already used.
if ($content -notmatch "<WhatsAppLeaveApprovalActionPanel") {
  $content = $content.Replace(
    '<div className="grid gap-5 md:grid-cols-3">',
    '<WhatsAppLeaveApprovalActionPanel leaveRequests={leaveRequests} employees={employees} onRefresh={onRefresh} />' + "`r`n`r`n" +
    '<div className="grid gap-5 md:grid-cols-3">',
    1
  )
}

# Pass refreshData into all WhatsAppActionCentreLive route calls.
$content = $content.Replace(
  'setActive={setActive}' + "`r`n" + '        />',
  'setActive={setActive}' + "`r`n" + '          onRefresh={refreshData}' + "`r`n" + '        />'
)

$content = $content.Replace(
  'setActive={setActive} />',
  'setActive={setActive} onRefresh={refreshData} />'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "WhatsApp leave approve-and-send panel installed."
Write-Host ""
Write-Host "WhatsApp Action Centre now has:"
Write-Host "- Approve + Send WhatsApp"
Write-Host "- Decline + Send WhatsApp"
Write-Host "- Supabase leave_requests.status update"
Write-Host "- Manager feedback saved"
Write-Host "- Data refresh after success"
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
