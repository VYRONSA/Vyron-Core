$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$newHelper = @'
async function sendLeaveDecisionWhatsApp({
  employees,
  leaveRequest,
  decision,
  feedback,
}: {
  employees: EmployeeRow[];
  leaveRequest: LeaveRequestRow;
  decision: "approved" | "declined" | "amended";
  feedback?: string;
}) {
  function cleanText(value: string | null | undefined) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function digitsOnly(value: string | null | undefined) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  const leaveEmployeeName = cleanText(leaveRequest.employee_name);
  const leaveEmployeeId = String(leaveRequest.employee_id || "").trim();

  const employeeById = employees.find((item) => String(item.id) === leaveEmployeeId);

  const employeeByExactName = employees.find((item) => {
    const displayName = cleanText(getEmployeeDisplayName(item));
    const fullName = cleanText(`${item.first_name || ""} ${item.last_name || ""}`);
    return Boolean(leaveEmployeeName) && (displayName === leaveEmployeeName || fullName === leaveEmployeeName);
  });

  const employeeBySoftName = employees.find((item) => {
    const displayName = cleanText(getEmployeeDisplayName(item));
    const fullName = cleanText(`${item.first_name || ""} ${item.last_name || ""}`);
    return (
      Boolean(leaveEmployeeName) &&
      (
        displayName.includes(leaveEmployeeName) ||
        leaveEmployeeName.includes(displayName) ||
        fullName.includes(leaveEmployeeName) ||
        leaveEmployeeName.includes(fullName)
      )
    );
  });

  const employee = employeeById || employeeByExactName || employeeBySoftName || null;

  const employeeName =
    leaveRequest.employee_name ||
    (employee ? getEmployeeDisplayName(employee) : "Employee");

  const rawPhone = employee?.phone || "";
  const phone = digitsOnly(rawPhone);

  if (!phone) {
    const debugId = leaveRequest.employee_id ? ` Leave employee_id: ${leaveRequest.employee_id}.` : "";
    const debugName = leaveRequest.employee_name ? ` Leave employee_name: ${leaveRequest.employee_name}.` : "";

    return {
      ok: false,
      skipped: true,
      error: `No phone number found for ${employeeName}.${debugId}${debugName} Check that this leave request is linked to the employee record with the saved phone number.`,
    };
  }

  const dateRange = `${formatDate(leaveRequest.start_date)} to ${formatDate(leaveRequest.end_date)}`;

  const message =
    decision === "approved"
      ? `Hi ${employeeName}, your leave request for ${dateRange} has been approved.${feedback ? ` Manager feedback: ${feedback}` : ""} Regards, VYRON CORE.`
      : decision === "declined"
      ? `Hi ${employeeName}, your leave request for ${dateRange} has not been approved.${feedback ? ` Reason: ${feedback}` : " Please contact your manager for feedback."} Regards, VYRON CORE.`
      : `Hi ${employeeName}, your leave request for ${dateRange} has been amended.${feedback ? ` Manager feedback: ${feedback}` : " Please contact your manager for the updated details."} Regards, VYRON CORE.`;

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
    return {
      ok: false,
      skipped: false,
      error: data.error || "WhatsApp leave notification failed.",
    };
  }

  return {
    ok: true,
    skipped: false,
    messageId: data.messageId || null,
  };
}
'@

if ($content -notmatch "function sendLeaveDecisionWhatsApp") {
  throw "Could not find sendLeaveDecisionWhatsApp in page.tsx. Upload the current page.tsx if this happens."
}

# Replace the complete helper function safely.
$pattern = 'async function sendLeaveDecisionWhatsApp\(\{[\s\S]*?\n\}'
$matches = [regex]::Matches($content, $pattern)

if ($matches.Count -eq 0) {
  throw "Could not match sendLeaveDecisionWhatsApp function body."
}

# Because the function contains nested braces, use a safer manual brace match from function start.
$start = $content.IndexOf("async function sendLeaveDecisionWhatsApp")
if ($start -lt 0) {
  throw "Could not locate sendLeaveDecisionWhatsApp start."
}

$braceStart = $content.IndexOf("{", $start)
if ($braceStart -lt 0) {
  throw "Could not locate sendLeaveDecisionWhatsApp opening brace."
}

$depth = 0
$end = -1

for ($i = $braceStart; $i -lt $content.Length; $i++) {
  $ch = $content[$i]
  if ($ch -eq "{") { $depth++ }
  if ($ch -eq "}") {
    $depth--
    if ($depth -eq 0) {
      $end = $i
      break
    }
  }
}

if ($end -lt 0) {
  throw "Could not locate sendLeaveDecisionWhatsApp closing brace."
}

$content = $content.Substring(0, $start) + $newHelper + $content.Substring($end + 1)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Leave WhatsApp phone lookup fixed."
Write-Host "It now matches employee by employee_id, exact name, and soft name fallback."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
