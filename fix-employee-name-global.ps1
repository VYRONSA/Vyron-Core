$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

$helperName = "getEmployeeDisplayName"

if ($content -notmatch "function\s+$helperName\s*\(") {
  $helper = @'

function getEmployeeDisplayName(employee: any) {
  if (!employee) return "Unknown employee";

  const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();

  return (
    fullName ||
    employee.employee_number ||
    employee.email ||
    employee.phone ||
    employee.name ||
    "Unknown employee"
  );
}

'@

  # Put it before the first major helper/function/export point.
  $inserted = $false

  $markers = @(
    "function formatCurrency",
    "function safeNumber",
    "export default function"
  )

  foreach ($marker in $markers) {
    if ($content.Contains($marker)) {
      $content = $content.Replace($marker, $helper + $marker)
      $inserted = $true
      break
    }
  }

  if (-not $inserted) {
    throw "Could not find safe insertion point for getEmployeeDisplayName helper."
  }
}

# Replace all missing old helper calls globally.
$content = $content.Replace("employeeName(", "getEmployeeDisplayName(")

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host "Fixed all employeeName(...) build errors globally in:"
Write-Host $filePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
