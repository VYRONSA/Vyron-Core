$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$helper = @'

async function sendLeaveDecisionWhatsApp({
  employees,
  leaveRequest,
  decision,
}: {
  employees: EmployeeRow[];
  leaveRequest: LeaveRequestRow;
  decision: "approved" | "declined" | "amended";
}) {
  const employee = employees.find((item) => String(item.id) === String(leaveRequest.employee_id));
  const employeeName =
    leaveRequest.employee_name ||
    (employee ? getEmployeeDisplayName(employee) : "Employee");

  const phone = employee?.phone || "";

  if (!phone) {
    return {
      ok: false,
      skipped: true,
      error: `No phone number saved for ${employeeName}.`,
    };
  }

  const dateRange = `${formatDate(leaveRequest.start_date)} to ${formatDate(leaveRequest.end_date)}`;

  const message =
    decision === "approved"
      ? `Hi ${employeeName}, your leave request for ${dateRange} has been approved. Regards, VYRON CORE.`
      : decision === "declined"
      ? `Hi ${employeeName}, your leave request for ${dateRange} has not been approved. Please contact your manager for feedback. Regards, VYRON CORE.`
      : `Hi ${employeeName}, your leave request for ${dateRange} has been amended. Please contact your manager for the updated details. Regards, VYRON CORE.`;

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
  $content = $content.Replace("`nfunction LeaveApprovalsScreen", "`n$helper`nfunction LeaveApprovalsScreen")
}

# Safer: add a new auto notification helper call into any leave status update success section.
# This targets the current common pattern inside LeaveApprovalsScreen after Supabase update succeeds.
$successPatterns = @(
  'onRefresh\(\);\s*setSavingId\(null\);',
  'setSavingId\(null\);\s*onRefresh\(\);'
)

$replacement = @'
const whatsappResult = await sendLeaveDecisionWhatsApp({
      employees,
      leaveRequest: request,
      decision: status as "approved" | "declined" | "amended",
    });

    if (!whatsappResult.ok && !whatsappResult.skipped) {
      setError(`Leave saved, but WhatsApp failed: ${whatsappResult.error}`);
    } else if (!whatsappResult.ok && whatsappResult.skipped) {
      setError(`Leave saved. WhatsApp skipped: ${whatsappResult.error}`);
    } else {
      setError(null);
    }

    onRefresh();
    setSavingId(null);
'@

$injected = $false
foreach ($pattern in $successPatterns) {
  if (!$injected -and $content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, $replacement, 1)
    $injected = $true
  }
}

if (!$injected) {
  Write-Host "WARNING: Could not find the leave success block to inject WhatsApp call."
  Write-Host "The helper was added, but the approval function may need a full-file edit."
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Auto WhatsApp leave approval pack applied."
Write-Host "Injected successfully: $injected"
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
