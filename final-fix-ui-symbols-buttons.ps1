$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"

$files = @(
  "$root\app\page.tsx",
  "$root\app\app-page.tsx"
)

$componentFiles = Get-ChildItem "$root\components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$files = $files + $componentFiles

foreach ($file in $files) {
  if (!(Test-Path $file)) { continue }

  $content = Get-Content $file -Raw
  $original = $content

  # 1) Remove common mojibake corruption.
  $content = $content.Replace("â†", "")
  $content = $content.Replace("â†�", "")
  $content = $content.Replace("â†’", "")
  $content = $content.Replace("Â±", "+")
  $content = $content.Replace("Â´", "")
  $content = $content.Replace("Â`", "")
  $content = $content.Replace("Â·", "·")
  $content = $content.Replace("Â ", " ")
  $content = $content.Replace("Â", "")
  $content = $content.Replace("Ã—", "x")
  $content = $content.Replace("â€“", "-")
  $content = $content.Replace("â€”", "-")
  $content = $content.Replace("â€˜", "'")
  $content = $content.Replace("â€™", "'")
  $content = $content.Replace("â€œ", '"')
  $content = $content.Replace("â€", '"')
  $content = $content.Replace("â€¦", "...")

  # 2) Force every visible Back button label to clean "Back" only.
  # This removes any broken arrow/text before Back.
  $content = $content -replace '>\s*[^<>{}]*Back\s*<', '>Back<'

  # 3) Force corrupt sidebar toggle text to simple ASCII.
  # Common patterns created by older batches:
  $content = $content -replace '\?\s*["''][^"'']{1,8}["'']\s*:\s*["''][^"'']{1,8}["'']', '? "-" : "+"'

  # 4) Specific cleanups around COMMAND labels.
  $content = $content -replace '(COMMAND\s*</[^>]+>\s*<[^>]+[^>]*>)\s*[^<>{}]{1,8}\s*(</[^>]+>)', '$1+$2'

  # 5) Clean duplicated spacing around Back.
  $content = $content.Replace("> Back<", ">Back<")
  $content = $content.Replace(">  Back<", ">Back<")

  if ($content -ne $original) {
    Set-Content -Path $file -Value $content -Encoding UTF8
    Write-Host "Patched UI symbols in: $file"
  }
}

Write-Host ""
Write-Host "Now fully restart local Next:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
