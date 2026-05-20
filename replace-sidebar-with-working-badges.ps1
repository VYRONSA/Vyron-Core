$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find $path"
}

$content = Get-Content $path -Raw

$newSidebar = @'
function Sidebar({
  active,
  setActive,
  closeMobile,
  alertCounts = {},
  openGroup,
  setOpenGroup
}: {
  active: string;
  setActive: (value: string) => void;
  closeMobile?: () => void;
  alertCounts?: Record<string, number>;
  openGroup: string;
  setOpenGroup: (value: string) => void;
}) {
  function openItem(item: string) {
    setActive(resolveNavigationTarget(item));
    if (closeMobile) closeMobile();
  }

  function getBadgeCount(item: string) {
    const resolved = resolveNavigationTarget(item);
    return alertCounts[item] || alertCounts[resolved] || 0;
  }

  function getGroupBadgeCount(items: string[]) {
    return items.reduce((sum, item) => sum + getBadgeCount(item), 0);
  }

  return (
    <aside className="flex h-full flex-col bg-[#050b16] text-white shadow-[22px_0_80px_rgba(15,23,42,0.35)]">
      <div className="border-b border-white/10 bg-white/[0.025] px-5 py-6">
        <div className="flex items-center gap-3">
          <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-lg shadow-blue-500/30">
            <div className="absolute left-[13px] top-[10px] h-8 w-3 rotate-[-28deg] rounded-sm bg-white" />
            <div className="absolute right-[13px] top-[10px] h-8 w-3 rotate-[28deg] rounded-sm bg-slate-950/80" />
          </div>
          <div>
            <div className="text-2xl font-black tracking-[0.32em]">VYRON</div>
            <div className="mt-[-2px] text-xs font-bold tracking-[0.55em] text-cyan-300">
              CORE
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
        {navGroups.map((group) => {
          const isOpen = openGroup === group.label;
          const groupAlertCount = getGroupBadgeCount(group.items);

          return (
            <div key={group.label} className="rounded-[24px] border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <button
                type="button"
                onClick={() => setOpenGroup(isOpen ? "" : group.label)}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-xs font-black uppercase tracking-[0.24em] transition ${
                  isOpen ? "text-cyan-300" : "text-slate-400 hover:text-white"
                }`}
              >
                <span>{group.label}</span>
                <span className="flex items-center gap-2">
                  {groupAlertCount > 0 && (
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-rose-500 px-2.5 py-1 text-[11px] font-black leading-none text-white shadow-lg shadow-rose-500/30">
                      {groupAlertCount > 99 ? "99+" : groupAlertCount}
                    </span>
                  )}
                  <span className="text-base">{isOpen ? "-" : "+"}</span>
                </span>
              </button>

              {isOpen && (
                <div className="space-y-1 px-2 pb-3">
                  {group.items.map((item) => {
                    const resolved = resolveNavigationTarget(item);
                    const isActive = active === resolved;
                    const itemBadgeCount = getBadgeCount(item);

                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => openItem(item)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${
                          isActive
                            ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30"
                            : "text-slate-300 hover:bg-white/10 hover:text-white hover:shadow-[0_0_26px_rgba(34,211,238,0.12)]"
                        }`}
                      >
                        <span className={isActive ? "text-white" : "text-slate-400"}>
                          <NavIcon item={resolved} />
                        </span>

                        <span className="flex-1">{displayNavigationLabel(item)}</span>

                        {itemBadgeCount > 0 && (
                          <span
                            className={`ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-black leading-none shadow-lg ${
                              isActive
                                ? "bg-white text-rose-600 shadow-white/20"
                                : "bg-rose-500 text-white shadow-rose-500/30"
                            }`}
                          >
                            {itemBadgeCount > 99 ? "99+" : itemBadgeCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
'@

$pattern = 'function Sidebar\(\{[\s\S]*?\n\}\s*\n\nfunction Header'

if ($content -notmatch $pattern) {
  throw "Could not locate Sidebar function block. Upload latest app/page.tsx if this fails."
}

$content = [regex]::Replace(
  $content,
  $pattern,
  $newSidebar + "`r`n`r`nfunction Header",
  1
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Sidebar replaced with safe group + submenu badge version."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
