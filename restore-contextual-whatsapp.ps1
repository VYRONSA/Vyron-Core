$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1. Remove WhatsApp Action Centre from sidebar arrays where possible.
$content = $content.Replace('      "WhatsApp Action Centre",' + "`r`n", "")
$content = $content.Replace('      "WhatsApp Action Centre",' + "`n", "")
$content = $content.Replace('      "WhatsApp Action Centre"', "")

# 2. Restore Leave navigation to real Leave page.
$content = $content.Replace('Leave: "WhatsApp Action Centre"', 'Leave: "Leave Management"')
$content = $content.Replace('"Leave Management": "WhatsApp Action Centre"', '"Leave Management": "Leave Management"')
$content = $content.Replace('"Leave Approvals": "WhatsApp Action Centre"', '"Leave Approvals": "Leave Management"')

# 3. Restore Leave routes.
$content = [regex]::Replace(
  $content,
  'if \(active === "Leave"\)[^\n]*return [^;]+;',
  'if (active === "Leave") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Management"\)[^\n]*return [^;]+;',
  'if (active === "Leave Management") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Approvals"\)[^\n]*return [^;]+;',
  'if (active === "Leave Approvals") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

# 4. Remove WhatsApp Action Centre badge keys from alertCounts if present.
$content = [regex]::Replace($content, '\s*"WhatsApp Action Centre": [^,\n]+,\r?\n', "`r`n")
$content = [regex]::Replace($content, '\s*Notifications: communicationCountsForSidebar\.total,\r?\n', "`r`n")
$content = [regex]::Replace($content, '\s*"Employee Notifications": communicationCountsForSidebar\.total,\r?\n', "`r`n")

# 5. Add safe generic WhatsApp send helper if missing.
$helper = @'

async function sendVyronWhatsAppMessage({
  to,
  message,
  employeeName,
  type,
}: {
  to: string;
  message: string;
  employeeName: string;
  type: string;
}) {
  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      message,
      employeeName,
      type,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || "WhatsApp failed.",
    };
  }

  return {
    ok: true,
    messageId: data.messageId || null,
  };
}

function findEmployeeForRecord({
  employees,
  employeeId,
  employeeName,
}: {
  employees: EmployeeRow[];
  employeeId?: string | null;
  employeeName?: string | null;
}) {
  const byId = employees.find((employee) => String(employee.id) === String(employeeId || ""));
  if (byId) return byId;

  const targetName = String(employeeName || "").trim().toLowerCase();

  return (
    employees.find((employee) => {
      const displayName = getEmployeeDisplayName(employee).trim().toLowerCase();
      const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim().toLowerCase();
      return targetName && (displayName === targetName || fullName === targetName);
    }) || null
  );
}

'@

if ($content -notmatch "function sendVyronWhatsAppMessage") {
  $content = $content.Replace("`nfunction LeaveApprovalsScreen", "`n$helper`nfunction LeaveApprovalsScreen")
}

# 6. Replace Leave approval update success block so it approves/declines and sends WhatsApp from the Leave page.
# Target current updateLeaveStatus success section where it sets saving and refreshes.
$oldBlocks = @(
'    setSavingId(null);
    onRefresh();
  }',
'    onRefresh();
    setSavingId(null);
  }'
)

$newBlock = @'
    const employee = findEmployeeForRecord({
      employees,
      employeeId: request.employee_id,
      employeeName: request.employee_name,
    });

    const employeeName =
      request.employee_name ||
      (employee ? getEmployeeDisplayName(employee) : "Employee");

    const phone = employee?.phone || "";
    const dateRange = `${formatDate(request.start_date)} to ${formatDate(request.end_date)}`;

    if (phone) {
      const message =
        status === "approved"
          ? `Hi ${employeeName}, your leave request for ${dateRange} has been approved.${feedback.trim() ? ` Manager feedback: ${feedback.trim()}` : ""} Regards, VYRON CORE.`
          : status === "declined"
          ? `Hi ${employeeName}, your leave request for ${dateRange} has not been approved.${feedback.trim() ? ` Reason: ${feedback.trim()}` : " Please contact your manager for feedback."} Regards, VYRON CORE.`
          : `Hi ${employeeName}, your leave request for ${dateRange} has been amended.${feedback.trim() ? ` Manager feedback: ${feedback.trim()}` : ""} Regards, VYRON CORE.`;

      const whatsAppResult = await sendVyronWhatsAppMessage({
        to: phone,
        message,
        employeeName,
        type: `leave_${status}`,
      });

      if (!whatsAppResult.ok) {
        setError(`Leave saved, but WhatsApp failed: ${whatsAppResult.error}`);
      } else {
        setError(`Leave saved and WhatsApp sent to ${employeeName}.`);
      }
    } else {
      setError(`Leave saved. WhatsApp skipped because no phone number is saved for ${employeeName}.`);
    }

    setSavingId(null);
    onRefresh();
  }
'@

$idx = $content.IndexOf("async function updateLeaveStatus")
if ($idx -ge 0) {
  foreach ($old in $oldBlocks) {
    $pos = $content.IndexOf($old, $idx)
    if ($pos -ge 0) {
      $content = $content.Substring(0, $pos) + $newBlock + $content.Substring($pos + $old.Length)
      break
    }
  }
}

# 7. If HR Cases screen has a status update function, add message helper through a dedicated panel.
# This safely adds a contextual HR WhatsApp panel before EmptyWorkAreaScreen, then routes HR Cases to it if the exact old route can be replaced.

$hrPanel = @'

function HrCasesWithWhatsAppActions({
  hrCases,
  employees,
  onRefresh,
}: {
  hrCases: HrCaseRow[];
  employees: EmployeeRow[];
  onRefresh: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const openCases = hrCases.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "resolved";
  });

  async function closeCaseAndSend(hrCase: HrCaseRow, status: "resolved" | "closed") {
    setBusyId(hrCase.id);
    setMessage(null);

    const employee = findEmployeeForRecord({
      employees,
      employeeId: hrCase.employee_id,
      employeeName: hrCase.employee_name,
    });

    const employeeName =
      hrCase.employee_name ||
      (employee ? getEmployeeDisplayName(employee) : "Employee");

    const feedback = feedbackById[hrCase.id] || "";

    try {
      const { error } = await supabase
        .from("hr_cases")
        .update({
          status,
          manager_feedback: feedback.trim() || "Case reviewed by management.",
        })
        .eq("id", hrCase.id);

      if (error) {
        setMessage(error.message);
        setBusyId(null);
        return;
      }

      if (employee?.phone) {
        const result = await sendVyronWhatsAppMessage({
          to: employee.phone,
          employeeName,
          type: `hr_case_${status}`,
          message: `Hi ${employeeName}, your HR case "${hrCase.case_type || "HR Case"}" has been reviewed by management.${feedback.trim() ? ` Feedback: ${feedback.trim()}` : ""} Regards, VYRON CORE.`,
        });

        if (!result.ok) {
          setMessage(`HR case ${status}, but WhatsApp failed: ${result.error}`);
        } else {
          setMessage(`HR case ${status} and WhatsApp sent to ${employeeName}.`);
        }
      } else {
        setMessage(`HR case ${status}. WhatsApp skipped because no phone number is saved for ${employeeName}.`);
      }

      setBusyId(null);
      onRefresh();
    } catch (error: any) {
      setMessage(error?.message || "HR case action failed.");
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="text-xs font-black uppercase tracking-[0.4em] text-rose-300">HR CONTROL</div>
        <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">HR Cases</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
          Resolve or close HR cases and send WhatsApp feedback directly from the HR case workflow.
        </p>
      </Panel>

      {message && <div className="rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-700">{message}</div>}

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Open HR cases</h2>

        <div className="mt-6 grid gap-4">
          {openCases.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
              No open HR cases.
            </div>
          ) : (
            openCases.map((hrCase) => {
              const employee = findEmployeeForRecord({
                employees,
                employeeId: hrCase.employee_id,
                employeeName: hrCase.employee_name,
              });

              const employeeName =
                hrCase.employee_name ||
                (employee ? getEmployeeDisplayName(employee) : "Employee");

              return (
                <div key={hrCase.id} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="text-lg font-black text-slate-950">{employeeName}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-500">{hrCase.case_type || "HR Case"}</div>
                      <div className="mt-2 text-xs font-bold text-slate-400">
                        Phone: {employee?.phone || "No phone number saved"}
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
                          placeholder="Feedback to send by WhatsApp..."
                        />
                      </label>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => closeCaseAndSend(hrCase, "resolved")}
                          disabled={busyId === hrCase.id}
                          className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                        >
                          {busyId === hrCase.id ? "Working..." : "Resolve + Send WhatsApp"}
                        </button>

                        <button
                          type="button"
                          onClick={() => closeCaseAndSend(hrCase, "closed")}
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
    </div>
  );
}

'@

if ($content -notmatch "function HrCasesWithWhatsAppActions") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$hrPanel`nfunction EmptyWorkAreaScreen")
}

$content = [regex]::Replace(
  $content,
  'if \(active === "HR Cases"\)[^\n]*return [^;]+;',
  'if (active === "HR Cases") return <HrCasesWithWhatsAppActions hrCases={hrCases} employees={employees} onRefresh={refreshData} />;'
)

if ($content -notmatch 'active === "HR Cases"\) return <HrCasesWithWhatsAppActions') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "HR Cases") return <HrCasesWithWhatsAppActions hrCases={hrCases} employees={employees} onRefresh={refreshData} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Contextual WhatsApp restore applied."
Write-Host ""
Write-Host "Result:"
Write-Host "- WhatsApp Action Centre removed from sidebar."
Write-Host "- Leave page approves/declines/amends and sends WhatsApp there."
Write-Host "- HR Cases resolves/closes and sends WhatsApp there."
Write-Host "- Warning WhatsApp can stay on Warnings page."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
