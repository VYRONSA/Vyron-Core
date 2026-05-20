$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find $path" }

$content = Get-Content $path -Raw

$editableStoresScreen = @'

function EditableStoresScreen({
  stores,
  exceptions,
  onRefresh,
  companyId,
}: {
  stores: StoreRow[];
  exceptions: ExceptionRow[];
  onRefresh: () => void;
  companyId: string;
}) {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(stores[0]?.id || null);
  const selectedStore = stores.find((store) => store.id === selectedStoreId) || null;

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [openingTime, setOpeningTime] = useState("");
  const [closingTime, setClosingTime] = useState("");
  const [gpsRadius, setGpsRadius] = useState("150");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedStore && stores[0]) {
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
    setSaveMessage(null);
    setSaveError(null);
  }, [selectedStoreId, stores, selectedStore]);

  async function saveStore() {
    if (!selectedStore) return;

    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    if (!name.trim()) {
      setSaveError("Store name is required.");
      setSaving(false);
      return;
    }

    const { error } = await supabase
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

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setSaveMessage("Store updated successfully.");
    setSaving(false);
    onRefresh();
  }

  async function archiveStore() {
    if (!selectedStore) return;

    const confirmed = window.confirm(`Archive ${selectedStore.name}? This keeps the record but removes it from active use.`);
    if (!confirmed) return;

    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    const { error } = await supabase
      .from("stores")
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedStore.id);

    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }

    setSaveMessage("Store archived.");
    setSaving(false);
    onRefresh();
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">Store Control</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">Stores</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Create, select and edit stores, operating hours, GPS radius and active status.
            </p>
          </div>

          <button onClick={onRefresh} className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
            Refresh stores
          </button>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-black text-slate-950">Store list</h3>
              <p className="mt-2 text-sm text-slate-500">Select a store to edit it.</p>
            </div>
            <StatusPill value={`${stores.length} stores`} />
          </div>

          <div className="mt-6 grid gap-3">
            {stores.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                No stores captured yet. Use Add Store from the original store workflow or dashboard quick action.
              </div>
            ) : (
              stores.map((store) => {
                const storeExceptions = exceptions.filter((item) => item.store_id === store.id && exceptionIsOpen(item)).length;

                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedStoreId(store.id)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                      selectedStoreId === store.id
                        ? "border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-500/10"
                        : "border-slate-100 bg-white hover:border-cyan-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-black text-slate-950">{store.name}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {store.region || "No region"} · {store.city || "No city"}
                        </div>
                      </div>
                      <StatusPill value={store.status || "active"} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{formatTimeOnly(store.opening_time)} - {formatTimeOnly(store.closing_time)}</span>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">GPS {store.gps_radius_meters || 150}m</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{storeExceptions} exceptions</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <Panel>
          {!selectedStore ? (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Select a store to edit.</div>
          ) : (
            <>
              <h3 className="text-2xl font-black text-slate-950">Edit store</h3>
              <p className="mt-2 text-sm text-slate-500">Changes save directly to Supabase.</p>

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

              {saveMessage && <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{saveMessage}</div>}
              {saveError && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{saveError}</div>}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={saveStore}
                  disabled={saving}
                  className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save store changes"}
                </button>

                <button
                  onClick={archiveStore}
                  disabled={saving}
                  className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700 disabled:opacity-60"
                >
                  Archive store
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

if ($content -notmatch "function EditableStoresScreen") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$editableStoresScreen`nfunction EmptyWorkAreaScreen")
}

# Make Staff/Employees route use the full existing EmployeesScreen again.
# The existing EmployeesScreen already has employee editing state/fields in this codebase.
$content = [regex]::Replace(
  $content,
  'if \(active === "Employees"\) return <StaffDrilldownHubScreen employees=\{employees\} stores=\{stores\} exceptions=\{exceptions\} hrCases=\{hrCases\} setActive=\{setActive\} onAddEmployee=\{\(\) => setAddEmployeeOpen\(true\)\} onRefresh=\{refreshData\} />;',
  'if (active === "Employees") return <EmployeesScreen employees={employees} stores={stores} exceptions={exceptions} hrCases={hrCases} onAddEmployee={() => setAddEmployeeOpen(true)} onRefresh={refreshData} />;'
)

# Make Stores route use the editable stores screen.
$content = [regex]::Replace(
  $content,
  'if \(active === "Stores"\) return <StoresManagementPanel stores=\{stores\} exceptions=\{exceptions\} onRefresh=\{refreshData\} companyId=\{currentCompanyId\} />;',
  'if (active === "Stores") return <EditableStoresScreen stores={stores} exceptions={exceptions} onRefresh={refreshData} companyId={currentCompanyId} />;'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Employee edit route restored and editable store screen added."
Write-Host ""
Write-Host "Now restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
