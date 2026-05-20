
$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find $path"
}

$content = Get-Content $path -Raw

$inject = @'

const activeLeaveRequestCount =
  leaveRequests?.filter((item) => item.status === "pending").length || 0;

const activeHrCaseCount =
  hrCases?.filter((item) => hrCaseIsOpen(item)).length || 0;

const activeExceptionCount =
  exceptions?.filter((item) => exceptionIsOpen(item)).length || 0;

'@

if ($content -notmatch 'activeLeaveRequestCount') {
  $content = $content.Replace('const navGroups = [', "$inject`r`nconst navGroups = [")
}

$oldBlock = @'
{group.items.map((item) => {
                  const resolved = resolveNavigationTarget(item);
                  const isActive = active === resolved;

                  return (
                    <button
'@

$newBlock = @'
{group.items.map((item) => {
                  const resolved = resolveNavigationTarget(item);
                  const isActive = active === resolved;

                  let badgeCount = 0;

                  if (
                    resolved === "Leave Management" ||
                    item === "Leave"
                  ) {
                    badgeCount = activeLeaveRequestCount;
                  }

                  if (
                    resolved === "HR Cases" ||
                    item === "HR"
                  ) {
                    badgeCount = activeHrCaseCount;
                  }

                  if (
                    resolved === "Exceptions" ||
                    item === "Exceptions"
                  ) {
                    badgeCount = activeExceptionCount;
                  }

                  return (
                    <button
'@

$content = $content.Replace($oldBlock, $newBlock)

$oldBadge = @'
<span>{displayNavigationLabel(item)}</span>
                    </button>
'@

$newBadge = @'
<div className="flex items-center gap-2">
                      <span>{displayNavigationLabel(item)}</span>

                      {badgeCount > 0 && (
                        <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white shadow-lg shadow-rose-500/30">
                          {badgeCount}
                        </span>
                      )}
                    </div>
                    </button>
'@

$content = $content.Replace($oldBadge, $newBadge)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "======================================"
Write-Host " VYRON CORE NOTIFICATION BADGES FIX"
Write-Host "======================================"
Write-Host ""
Write-Host "Red active badges added for:"
Write-Host "- Leave requests"
Write-Host "- HR cases"
Write-Host "- Exceptions"
Write-Host ""
