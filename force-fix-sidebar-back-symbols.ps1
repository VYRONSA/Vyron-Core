$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"

$files = @(
  "$root\app\page.tsx",
  "$root\app\app-page.tsx"
)

$componentFiles = Get-ChildItem "$root\components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$files = $files + $componentFiles

$badToGood = @{
  "â†" = "←"
  "â†�" = "←"
  "â†’" = "→"
  "â€“" = "–"
  "â€”" = "—"
  "â€˜" = "'"
  "â€™" = "'"
  "â€œ" = '"'
  "â€" = '"'
  "â€¦" = "…"
  "â€¢" = "•"
  "Ã—" = "×"
  "Ã·" = "÷"
  "Ã±" = "ñ"
  "Ã©" = "é"
  "Ã¨" = "è"
  "Ã¡" = "á"
  "Ã¶" = "ö"
  "Ã¼" = "ü"
  "Â·" = "·"
  "Â " = " "
  "Â " = " "
  "Â+" = "+"
  "Â-" = "-"
  "Â–" = "–"
  "Â—" = "—"
  "Â×" = "×"
  "Â✓" = "✓"
  "Â←" = "←"
  "Â→" = "→"
  "Â´" = ""
  "Â`" = ""
  "Â" = ""
}

foreach ($file in $files) {
  if (!(Test-Path $file)) { continue }

  $content = Get-Content $file -Raw
  $original = $content

  foreach ($bad in $badToGood.Keys) {
    $content = $content.Replace($bad, $badToGood[$bad])
  }

  # Force broken Back button text to normal JSX text.
  # Fixes visible results like: â† Back, â Back, Â´ Back, Ã— Back, etc.
  $content = $content -replace '>\s*[^<]{0,12}\s*Back\s*<', '>← Back<'

  # Force common sidebar collapse/expand symbols to clean +/- where corrupted.
  # This targets string literals only, not code operators.
  $content = $content -replace '"[ÂÃâ][^"]{0,8}"', '"-"'
  $content = $content -replace "'[ÂÃâ][^']{0,8}'", "'-'"

  # Fix any accidental double arrow.
  $content = $content.Replace("← ← Back", "← Back")
  $content = $content.Replace("←  Back", "← Back")

  if ($content -ne $original) {
    Set-Content -Path $file -Value $content -Encoding UTF8
    Write-Host "Fixed: $file"
  }
}

Write-Host ""
Write-Host "IMPORTANT: Restart Next.js fully so the browser stops showing cached .next output:"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
Write-Host ""
Write-Host "Then hard refresh browser with Ctrl + Shift + R."
