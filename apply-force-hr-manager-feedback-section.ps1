$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# ------------------------------------------------------------
# 1. Make sure hr_cases type supports manager_feedback
# ------------------------------------------------------------
if ($content -match "type HrCaseRow = \{") {
  if ($content -notmatch "manager_feedback\?: string") {
    $content = $content -replace "(type HrCaseRow = \{)", "`$1`r`n  manager_feedback?: string | null;"
  }
}

if ($content -match "interface HrCaseRow \{") {
  if ($content -notmatch "manager_feedback\?: string") {
    $content = $content -replace "(interface HrCaseRow \{)", "`$1`r`n  manager_feedback?: string | null;"
  }
}

# ------------------------------------------------------------
# 2. Make sure Supabase selects pull manager_feedback
# ------------------------------------------------------------
$content = $content.Replace(
  "id, employee_id, status, employee_response, employee_response_required, validity_status",
  "id, employee_id, status, employee_response, employee_response_required, validity_status, manager_feedback"
)

$content = $content.Replace(
  "id, employee_id, status, employee_response",
  "id, employee_id, status, employee_response, employee_response_required, validity_status, manager_feedback"
)

# ------------------------------------------------------------
# 3. Stop saving outgoing manager message into employee_response
# ------------------------------------------------------------

$content = $content -replace 'employee_response:\s*feedback\.trim\(\)\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedback.trim() || "Case reviewed by management.",'
$content = $content -replace 'employee_response_required:\s*false,', 'employee_response_required: true,'
$content = $content -replace 'validity_status:\s*"review_required",', 'validity_status: "waiting_for_employee",'

# ------------------------------------------------------------
# 4. Insert manager section before employee response section
# ------------------------------------------------------------

$managerSection = @'
                      <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                          Last manager WhatsApp message
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {hrCase.manager_feedback || "No manager WhatsApp message saved yet."}
                        </div>
                      </div>

'@

if ($content -notmatch "Last manager WhatsApp message") {
  # Try to insert before the visible employee response card label.
  $employeeLabel = '<div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">'
  $employeeText = 'Employee WhatsApp reply / response'

  $idx = $content.IndexOf($employeeText)
  if ($idx -gt 0) {
    $insertAt = $content.LastIndexOf('<div className="mt-3 rounded-2xl', $idx)
    if ($insertAt -gt 0) {
      $content = $content.Substring(0, $insertAt) + $managerSection + $content.Substring($insertAt)
    }
  }
}

# ------------------------------------------------------------
# 5. If employee response section still does not exist, add both sections after the HR case description
# ------------------------------------------------------------
if ($content -notmatch "Employee WhatsApp reply / response") {
  $anchor = @'
                      {hrCase.description && (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                          {hrCase.description}
                        </div>
                      )}
'@

  $bothSections = $anchor + @'

                      <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                          Last manager WhatsApp message
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {hrCase.manager_feedback || "No manager WhatsApp message saved yet."}
                        </div>
                      </div>

                      <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">
                          Employee WhatsApp reply / response
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-900">
                          {hrCase.employee_response || "No employee response received yet."}
                        </div>
                      </div>
'@

  if ($content.Contains($anchor)) {
    $content = $content.Replace($anchor, $bothSections)
  }
}

# ------------------------------------------------------------
# 6. Add visible warning text if both sections could not be inserted
# ------------------------------------------------------------
if ($content -notmatch "Last manager WhatsApp message") {
  Write-Host ""
  Write-Host "WARNING: Could not find the exact HR card location to insert the manager feedback section."
  Write-Host "Your page.tsx structure is different from expected."
  Write-Host "Send your current page.tsx if this warning appears."
  Write-Host ""
} else {
  Write-Host ""
  Write-Host "HR manager feedback section inserted successfully."
  Write-Host ""
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Done."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
