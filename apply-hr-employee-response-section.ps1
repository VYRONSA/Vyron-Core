$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$content = $content.Replace(
  'Saved feedback/response: {hrCase.employee_response}',
  'Employee WhatsApp reply / response: {hrCase.employee_response}'
)

$oldBlock = @'
                      {hrCase.employee_response && (
                        <div className="mt-3 rounded-2xl bg-cyan-50 p-3 text-sm leading-6 text-cyan-800">
                          Saved feedback/response: {hrCase.employee_response}
                        </div>
                      )}
'@

$newBlock = @'
                      <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-cyan-700">
                          Employee WhatsApp reply / response
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-900">
                          {hrCase.employee_response || "No employee response received yet."}
                        </div>
                      </div>
'@

if ($content.Contains($oldBlock)) {
  $content = $content.Replace($oldBlock, $newBlock)
}

$oldBlock2 = @'
                      {hrCase.employee_response && (
                        <div className="mt-3 rounded-2xl bg-cyan-50 p-3 text-sm leading-6 text-cyan-800">
                          Employee WhatsApp reply / response: {hrCase.employee_response}
                        </div>
                      )}
'@

if ($content.Contains($oldBlock2)) {
  $content = $content.Replace($oldBlock2, $newBlock)
}

if ($content -notmatch "No employee response received yet") {
  $anchor = @'
                      {hrCase.description && (
                        <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                          {hrCase.description}
                        </div>
                      )}
'@

  $insert = $anchor + @'

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
    $content = $content.Replace($anchor, $insert)
  }
}

$content = $content.Replace(
  '.select("id, employee_id, status")',
  '.select("id, employee_id, status, employee_response, employee_response_required, validity_status")'
)

if ($content -match "type HrCaseRow = \{") {
  if ($content -notmatch "employee_response\?: string") {
    $content = $content -replace "(type HrCaseRow = \{)", "`$1`r`n  employee_response?: string | null;`r`n  employee_response_required?: boolean | null;`r`n  validity_status?: string | null;"
  }
}

if ($content -match "interface HrCaseRow \{") {
  if ($content -notmatch "employee_response\?: string") {
    $content = $content -replace "(interface HrCaseRow \{)", "`$1`r`n  employee_response?: string | null;`r`n  employee_response_required?: boolean | null;`r`n  validity_status?: string | null;"
  }
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "HR employee response section added."
