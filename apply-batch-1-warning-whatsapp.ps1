$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find: $path" }

$content = Get-Content $path -Raw

$helper = @'

async function sendWarningWhatsApp({
  employee,
  warningText,
}: {
  employee: EmployeeRow;
  warningText: string;
}) {
  const employeeName = getEmployeeDisplayName(employee);
  const phone = employee.phone || "";

  if (!phone) {
    return { ok: false, skipped: true, error: `No phone number saved for ${employeeName}.` };
  }

  const message =
    warningText ||
    `Hi ${employeeName}, this is an official HR notice from VYRON CORE. Please contact your manager regarding a warning or HR matter that requires your attention.`;

  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: phone,
      message,
      employeeName,
      type: "hr_warning",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return { ok: false, skipped: false, error: data.error || "WhatsApp warning failed." };
  }

  return { ok: true, skipped: false, messageId: data.messageId || null };
}

function WarningWhatsAppQuickPanel({
  employees,
  setActive,
}: {
  employees: EmployeeRow[];
  setActive: (value: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id || "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

  const employee = employees.find((item) => item.id === employeeId) || employees[0] || null;

  useEffect(() => {
    if (!employeeId && employees[0]?.id) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  async function sendNow() {
    if (!employee) return;

    setSending(true);
    setResultText(null);

    const result = await sendWarningWhatsApp({
      employee,
      warningText: message,
    });

    if (result.ok) setResultText("Warning WhatsApp sent successfully.");
    if (!result.ok) setResultText(result.error || "Warning WhatsApp failed.");

    setSending(false);
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Warning WhatsApp Quick Send</h2>
          <p className="mt-2 text-sm text-slate-500">
            Send a warning or HR notice directly from the warning workflow.
          </p>
        </div>

        <button
          onClick={() => setActive("WhatsApp Action Centre")}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-cyan-300"
        >
          Open WhatsApp Centre
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
        <label className="text-sm font-bold">
          Employee
          <select
            value={employee?.id || ""}
            onChange={(event) => setEmployeeId(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
          >
            {employees.map((item) => (
              <option key={item.id} value={item.id}>
                {getEmployeeDisplayName(item)} {item.phone ? `- ${item.phone}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-bold">
          Message
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-2 min-h-28 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
            placeholder="Type warning message..."
          />
        </label>
      </div>

      {resultText && <div className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-700">{resultText}</div>}

      <div className="mt-5">
        <button
          onClick={sendNow}
          disabled={sending || !employee}
          className="rounded-2xl bg-rose-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send Warning WhatsApp"}
        </button>
      </div>
    </Panel>
  );
}

'@

if ($content -notmatch "function WarningWhatsAppQuickPanel") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$helper`nfunction EmptyWorkAreaScreen")
}

# Add panel into warnings page if it exists, before final closing of WarningsDrilldownOnlyPage by appending before WhatsApp section if found.
if ($content -match "function WarningsDrilldownOnlyPage" -and $content -notmatch "<WarningWhatsAppQuickPanel") {
  $content = $content.Replace(
    '<Panel>' + "`r`n" + '        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">' + "`r`n" + '          <div>' + "`r`n" + '            <h2 className="text-2xl font-black text-slate-950">Employees needing warning review</h2>',
    '<WarningWhatsAppQuickPanel employees={employees} setActive={setActive} />' + "`r`n`r`n" +
    '<Panel>' + "`r`n" + '        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">' + "`r`n" + '          <div>' + "`r`n" + '            <h2 className="text-2xl font-black text-slate-950">Employees needing warning review</h2>'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 1 applied: Warning WhatsApp quick send."
