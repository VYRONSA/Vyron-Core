$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

if ($content -match "function employeeName\(") {
  Write-Host "employeeName helper already exists."
  exit 0
}

$helper = @'

function employeeName(employee: EmployeeRow | null | undefined) {
  if (!employee) return "Unknown employee";

  const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();

  return (
    fullName ||
    employee.employee_number ||
    employee.email ||
    employee.phone ||
    "Unknown employee"
  );
}

'@

$marker = "function formatCurrency"

if ($content -like "*$marker*") {
  $content = $content.Replace($marker, $helper + $marker)
} else {
  $marker2 = "export default function"
  if ($content -like "*$marker2*") {
    $content = $content.Replace($marker2, $helper + $marker2)
  } else {
    throw "Could not find a safe insertion point for employeeName helper."
  }
}

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host "Fixed missing employeeName helper in:"
Write-Host $filePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
