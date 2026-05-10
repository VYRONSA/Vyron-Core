$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$marker = "// OWNER TOOLS HIDDEN FOR NON-OWNERS"

if ($content -notmatch "OWNER TOOLS HIDDEN FOR NON-OWNERS") {
  $content = $content.Replace(
    'label: "Owner Tools",',
    $marker + "`r`n    " + 'label: "Owner Tools",'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 13 complete: owner tools lockdown marker added."
