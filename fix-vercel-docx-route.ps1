$ErrorActionPreference = "Stop"

$routePath = "C:\Users\humres\vyron-core-web\app\api\contracts\render-docx\route.ts"

if (!(Test-Path $routePath)) {
  throw "File not found: $routePath"
}

$content = Get-Content $routePath -Raw

if ($content -match "new NextResponse\(new Blob\(\[output as BlobPart\]") {
  Write-Host "Already fixed: route.ts already returns a Blob response."
  exit 0
}

$old = "return new NextResponse(output, {"
$new = @"
const responseBody = new Blob([output as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    return new NextResponse(responseBody, {
"@

if ($content -notlike "*$old*") {
  throw "Could not find expected line: $old"
}

$content = $content.Replace($old, $new)

Set-Content -Path $routePath -Value $content -Encoding UTF8

Write-Host "Fixed DOCX API response type in:"
Write-Host $routePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
