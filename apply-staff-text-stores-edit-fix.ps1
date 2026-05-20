$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# 1) Clean broken arrow / mojibake text everywhere.
$badValues = @(
  "â†’",
  "â†",
  "Â»",
  "Â·",
  "Â",
  "→"
)

foreach ($bad in $badValues) {
  $content = $content.Replace($bad, "")
}

# 2) Add a safe editable Stores page with Add Store and Save Store Changes.
$component = @'

function StoresEditAndAddSafePage({
  stores,
  exceptions,
  setActive,
  onAddStore,
  onRefresh,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  setActive: (value: string) => void;
  onAddStore: () => void;
  onRefresh: () => void;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>(stores[0]?.id || "");
  const selectedStore = stores.find((store) => store.id === selectedStoreId) || stores[0] || null;

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [openingTime, setOpeningTime] = useState("");
  const [closingTime, setClosingTime] = useState("");
  const [gpsRadius, setGpsRadius] = useState("150");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedStoreId && stores[0]?.id) {
      setSelectedStoreId(stores[0].id);
      return;
    }

    if (!selectedStore) return;

    setName(selectedStore.name || "");
    setRegion(selectedStore.region || "");
    setCity(selectedStore.city || "");
    setAddress(selectedStore.address || "");
    setOpeningTime(selectedStore.opening_time || "");
    setClosingTime(selectedStore.closing_time || "");
    setGpsRadius(String(selectedStore.gps_radius_meters || 150));
    setStatus(selectedStore.status || "active");
    setMessage(null);
    setSaveError(null);
  }, [selectedStoreId, stores, selectedStore]);

  async function saveStoreChanges() {
    if (!selectedStore) return;

    setSaving(true);
    setMessage(null);
    setSaveError(null);

    if (!name.trim()) {
      setSaveError("Store name is required.");
      setSaving(false);
      return;
    }

    const result = await supabase
      .from("stores")
      .update({
        name: name.trim(),
        region: region.trim() || null,
        city: city.trim() || null,
        address: address.trim() || null,
        opening_time: openingTime || null,
        closing_time: closingTime || null,
        gps_radius_meters: Number(gpsRadius) || 150,
        status: status || "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedStore.id);

    if (result.error) {
      setSaveError(result.error.message);
      setSaving(false);
      return;
    }

    setMessage("Store updated successfully.");
    setSaving(false);
    onRefresh();
  }

  async function archiveStore() {
    if (!selectedStore) return;

    const confirmed = window.confirm(`Archive ${selectedStore.name}?`);
    if (!confirmed) return;

    setSaving(true);
    setMessage(null);
    setSaveError(null);

    const result = await supabase
      .from("stores")
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedStore.id);

    if (result.error) {
      setSaveError(result.error.message);
      setSaving(false);
      return;
    }

    setMessage("Store archived.");
    setSaving(false);
    onRefresh();
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">STORE CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Stores</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Add stores, edit locations, manage opening times, GPS radius and active status.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onAddStore}
              className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
            >
              Add Store
            </button>

            <button
              type="button"
              onClick={onRefresh}
              className="w-fit rounded-2xl border border-cyan-400/30 px-5 py-3 text-sm font-black text-cyan-300"
            >
              Refresh
            </button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-950">Store list</h2>
              <p className="mt-2 text-sm text-slate-500">Select a store to edit it.</p>
            </div>

            <button
              type="button"
              onClick={onAddStore}
              className="rounded-2xl bg-[#06101f] px-4 py-3 text-sm font-black text-cyan-300"
            >
              Add Store
            </button>
          </div>

          <div className="mt-6 grid gap-3">
            {stores.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-500">No stores captured yet.</div>
                <button
                  type="button"
                  onClick={onAddStore}
                  className="mt-4 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300"
                >
                  Add first store
                </button>
              </div>
            ) : (
              stores.map((store) => {
                const storeExceptions = exceptions.filter((item) => item.store_id === store.id && exceptionIsOpen(item));

                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedStoreId(store.id)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                      selectedStore?.id === store.id
                        ? "border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-500/10"
                        : "border-slate-100 bg-white hover:border-cyan-200"
                    }`}
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-black text-slate-950">{store.name}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {store.city || "No city"} · {store.region || "No region"}
                        </div>
                      </div>

                      <StatusPill value={store.status || "active"} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                        {formatTimeOnly(store.opening_time)} - {formatTimeOnly(store.closing_time)}
                      </span>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">
                        GPS {store.gps_radius_meters || 150}m
                      </span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                        {storeExceptions.length} exception(s)
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <Panel>
          {!selectedStore ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
              Select a store to edit, or add a new store.
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-black text-slate-950">Edit store</h2>
              <p className="mt-2 text-sm text-slate-500">Save location, trading hours, GPS and active status.</p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <FormInput label="Store name" value={name} onChange={setName} placeholder="Store name" />
                <FormInput label="City" value={city} onChange={setCity} placeholder="Cape Town" />
                <FormInput label="Region" value={region} onChange={setRegion} placeholder="Western Cape" />
                <FormInput label="GPS radius meters" value={gpsRadius} onChange={setGpsRadius} placeholder="150" />
                <FormInput label="Opening time" value={openingTime} onChange={setOpeningTime} type="time" />
                <FormInput label="Closing time" value={closingTime} onChange={setClosingTime} type="time" />

                <label className="text-sm font-bold">
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>

              <label className="mt-4 block text-sm font-bold">
                Address
                <textarea
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
                  placeholder="Store address"
                />
              </label>

              {message && <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}
              {saveError && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{saveError}</div>}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={saveStoreChanges}
                  disabled={saving}
                  className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save store changes"}
                </button>

                <button
                  type="button"
                  onClick={archiveStore}
                  disabled={saving}
                  className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700 disabled:opacity-60"
                >
                  Archive store
                </button>

                <button
                  type="button"
                  onClick={() => setActive("Rosters")}
                  className="rounded-2xl bg-cyan-50 px-5 py-3 text-sm font-black text-cyan-700"
                >
                  Open rosters
                </button>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

'@

if ($content -notmatch "function StoresEditAndAddSafePage") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Replace ALL route returns for Stores to the editable+add page.
$content = [regex]::Replace(
  $content,
  'if \(active === "Stores"\)[^\n]*return [^;]+;',
  'if (active === "Stores") return <StoresEditAndAddSafePage stores={stores} exceptions={exceptions} setActive={setActive} onAddStore={() => setAddStoreOpen(true)} onRefresh={refreshData} />;'
)

if ($content -notmatch 'active === "Stores"\) return <StoresEditAndAddSafePage') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Stores") return <StoresEditAndAddSafePage stores={stores} exceptions={exceptions} setActive={setActive} onAddStore={() => setAddStoreOpen(true)} onRefresh={refreshData} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

# Final cleanup of any arrow mojibake introduced by prior patches.
$content = $content.Replace("â†’", "")
$content = $content.Replace("→", "")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Staff text cleanup and Stores edit/add page fixed."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
