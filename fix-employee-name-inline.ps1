$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

$oldBlock = @'
    selectEmployee(matchedEmployee.id);
    setEmployeeSearch(employeeName(matchedEmployee));
    setLastMessage(`${employeeName(matchedEmployee)} selected.`);
'@

$newBlock = @'
    const matchedEmployeeName =
      `${matchedEmployee.first_name || ""} ${matchedEmployee.last_name || ""}`.trim() ||
      matchedEmployee.employee_number ||
      matchedEmployee.email ||
      matchedEmployee.phone ||
      "Unknown employee";

    selectEmployee(matchedEmployee.id);
    setEmployeeSearch(matchedEmployeeName);
    setLastMessage(`${matchedEmployeeName} selected.`);
'@

if ($content -like "*$oldBlock*") {
  $content = $content.Replace($oldBlock, $newBlock)
  Set-Content -Path $filePath -Value $content -Encoding UTF8
  Write-Host "Fixed employeeName build error by inlining matchedEmployeeName."
  exit 0
}

# Fallback replacements if spacing changed
if ($content -like '*setEmployeeSearch(employeeName(matchedEmployee));*') {
  $content = $content.Replace(
    '    selectEmployee(matchedEmployee.id);
    setEmployeeSearch(employeeName(matchedEmployee));
    setLastMessage(`${employeeName(matchedEmployee)} selected.`);',
    $newBlock
  )

  if ($content -like '*employeeName(matchedEmployee)*') {
    throw "employeeName(matchedEmployee) still exists after fallback patch. Please send lines 5055 to 5075 of app/app-page.tsx."
  }

  Set-Content -Path $filePath -Value $content -Encoding UTF8
  Write-Host "Fixed employeeName build error with fallback patch."
  exit 0
}

if ($content -notlike '*employeeName(matchedEmployee)*') {
  Write-Host "employeeName(matchedEmployee) is already gone. Run npm run build again."
  exit 0
}

throw "Could not safely patch employeeName section. Please send lines 5055 to 5075 of app/app-page.tsx."
