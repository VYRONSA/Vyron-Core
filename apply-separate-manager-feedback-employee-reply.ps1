$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$old1 = @'
        .update({
          status,
          employee_response_required: false,
          employee_response: feedback.trim() || "Case reviewed by management.",
          validity_status: "review_required",
        })
'@

$new1 = @'
        .update({
          status,
          employee_response_required: true,
          manager_feedback: feedback.trim() || "Case reviewed by management.",
          validity_status: "waiting_for_employee",
        })
'@

$content = $content.Replace($old1, $new1)

$old2 = @'
        .update({
          status: resolution,
          employee_response_required: false,
          employee_response: feedback.trim() || "Case reviewed by management.",
          validity_status: "review_required",
        })
'@

$new2 = @'
        .update({
          status: resolution,
          employee_response_required: true,
          manager_feedback: feedback.trim() || "Case reviewed by management.",
          validity_status: "waiting_for_employee",
        })
'@

$content = $content.Replace($old2, $new2)

$content = $content.Replace(
  "id, employee_id, status, employee_response, employee_response_required, validity_status",
  "id, employee_id, status, employee_response, employee_response_required, validity_status, manager_feedback"
)

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

if ($content -notmatch "Last manager WhatsApp message") {
  $employeeSection = @'
                      <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">
                          Employee WhatsApp reply / response
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-900">
                          {hrCase.employee_response || "No employee response received yet."}
                        </div>
                      </div>
'@

  $managerSection = @'
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

  if ($content.Contains($employeeSection)) {
    $content = $content.Replace($employeeSection, $managerSection)
  }
}

$content = $content.Replace(
  "HR case resolved and WhatsApp sent to",
  "Manager message sent and HR case marked resolved for"
)

$content = $content.Replace(
  "HR case closed and WhatsApp sent to",
  "Manager message sent and HR case marked closed for"
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Manager feedback vs employee reply separation applied."
Write-Host ""
Write-Host "Manager feedback now saves to: manager_feedback"
Write-Host "Employee replies stay in: employee_response"
