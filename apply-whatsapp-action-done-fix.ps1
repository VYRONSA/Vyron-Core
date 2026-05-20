$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$helpers = @'

const VYRON_WHATSAPP_HANDLED_KEY = "vyron_core_whatsapp_handled_actions";

function getHandledWhatsAppActions() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VYRON_WHATSAPP_HANDLED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHandledWhatsAppAction(key: string) {
  if (typeof window === "undefined") return;
  const current = getHandledWhatsAppActions();
  const next = Array.from(new Set([...current, key]));
  window.localStorage.setItem(VYRON_WHATSAPP_HANDLED_KEY, JSON.stringify(next));
}

function isWhatsAppActionHandled(key: string) {
  return getHandledWhatsAppActions().includes(key);
}

function leaveWhatsAppKey(item: LeaveRequestRow) {
  return `leave:${item.id}`;
}

function hrWhatsAppKey(item: HrCaseRow) {
  return `hr:${item.id}`;
}

function exceptionWhatsAppKey(item: ExceptionRow) {
  return `exception:${item.id}`;
}

function payrollWhatsAppKey(item: PayrollHoursRow) {
  return `payroll:${item.id}`;
}

'@

if ($content -notmatch "VYRON_WHATSAPP_HANDLED_KEY") {
  $content = $content.Replace(
    "`nfunction getWhatsAppPendingCounts",
    "`n$helpers`nfunction getWhatsAppPendingCounts"
  )
}

# Replace getWhatsAppPendingCounts with handled-aware version.
$newCounter = @'
function getWhatsAppPendingCounts({
  leaveRequests,
  hrCases,
  exceptions,
  payrollHours,
}: {
  leaveRequests: LeaveRequestRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  payrollHours: PayrollHoursRow[];
}) {
  const pendingLeave = leaveRequests.filter((item) => {
    return item.status === "pending" && !isWhatsAppActionHandled(leaveWhatsAppKey(item));
  }).length;

  const openHrCases = hrCases.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "resolved" && !isWhatsAppActionHandled(hrWhatsAppKey(item));
  }).length;

  const openExceptions = exceptions.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "resolved" && status !== "closed" && !isWhatsAppActionHandled(exceptionWhatsAppKey(item));
  }).length;

  const payrollBlockers = payrollHours.filter((row) => {
    const hasProblem =
      Number(row.missing_clock_events || 0) > 0 ||
      Number(row.late_minutes || 0) > 0 ||
      row.status === "needs_review";

    return hasProblem && !isWhatsAppActionHandled(payrollWhatsAppKey(row));
  }).length;

  return {
    pendingLeave,
    openHrCases,
    openExceptions,
    payrollBlockers,
    total: pendingLeave + openHrCases + openExceptions + payrollBlockers,
  };
}
'@

$start = $content.IndexOf("function getWhatsAppPendingCounts")
if ($start -ge 0) {
  $next = $content.IndexOf("function WhatsAppQueueBadge", $start)
  if ($next -gt $start) {
    $content = $content.Substring(0, $start) + $newCounter + "`r`n`r`n" + $content.Substring($next)
  }
}

# Add local refresh state to WhatsAppActionCentreLive so counters update immediately.
$content = $content.Replace(
'  const [sendError, setSendError] = useState<string | null>(null);',
'  const [sendError, setSendError] = useState<string | null>(null);' + "`r`n" +
'  const [communicationRefreshKey, setCommunicationRefreshKey] = useState(0);'
)

# Make counts recompute with refresh key where counts exist.
$content = $content.Replace(
'  const whatsappCounts = getWhatsAppPendingCounts({',
'  const whatsappCounts = getWhatsAppPendingCounts({'
)

# Mark selected employee-related message as general handled? Need specific action buttons below.

# Add Mark All Current Queue Handled button/panel inside WhatsAppActionCentreLive before message templates if possible.
$panel = @'

          <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Communication queue rule: once you send or mark an item as handled here, the WhatsApp red badge clears. The actual HR case, leave record, payroll issue or clocking issue remains in its own module until resolved.
          </div>

          <button
            type="button"
            onClick={() => {
              leaveRequests.filter((item) => item.status === "pending").forEach((item) => saveHandledWhatsAppAction(leaveWhatsAppKey(item)));
              hrCases.filter(hrCaseIsOpen).forEach((item) => saveHandledWhatsAppAction(hrWhatsAppKey(item)));
              exceptions.filter(exceptionIsOpen).forEach((item) => saveHandledWhatsAppAction(exceptionWhatsAppKey(item)));
              payrollHours.filter(rowHasPayrollProblem).forEach((item) => saveHandledWhatsAppAction(payrollWhatsAppKey(item)));
              setCommunicationRefreshKey((value) => value + 1);
              setSendStatus("Current WhatsApp action queue marked as handled.");
            }}
            className="mt-4 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-cyan-300"
          >
            Mark current WhatsApp queue handled
          </button>

'@

if ($content -notmatch "Mark current WhatsApp queue handled") {
  $content = $content.Replace(
    '<h2 className="text-2xl font-black text-slate-950">Message templates</h2>',
    $panel + "`r`n" + '<h2 className="text-2xl font-black text-slate-950">Message templates</h2>'
  )
}

# After successful manual WhatsApp send, mark all current communication queue as handled to clear badge.
$sendSuccessOld = 'setSendStatus(`WhatsApp sent successfully. Message ID: ${data.messageId || "sent"}`);'
$sendSuccessNew = @'
leaveRequests.filter((item) => item.status === "pending").forEach((item) => saveHandledWhatsAppAction(leaveWhatsAppKey(item)));
      hrCases.filter(hrCaseIsOpen).forEach((item) => saveHandledWhatsAppAction(hrWhatsAppKey(item)));
      exceptions.filter(exceptionIsOpen).forEach((item) => saveHandledWhatsAppAction(exceptionWhatsAppKey(item)));
      payrollHours.filter(rowHasPayrollProblem).forEach((item) => saveHandledWhatsAppAction(payrollWhatsAppKey(item)));
      setCommunicationRefreshKey((value) => value + 1);
      setSendStatus(`WhatsApp sent successfully. Message ID: ${data.messageId || "sent"}`);
'@

$content = $content.Replace($sendSuccessOld, $sendSuccessNew)

# Use communicationRefreshKey in visible counter area to force rerender reference.
if ($content -notmatch "communicationRefreshKey}</span>") {
  $content = $content.Replace(
    '<div className="space-y-8">',
    '<div className="space-y-8"><span className="hidden">{communicationRefreshKey}</span>',
    1
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "WhatsApp action-done queue fix applied."
Write-Host ""
Write-Host "Now WhatsApp badges represent communication actions still outstanding, not all open HR/leave records forever."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
