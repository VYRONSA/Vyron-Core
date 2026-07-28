import Image from "next/image";

export default function MaintenanceScreen({
  message,
  expectedReturnAt,
  overrideInvalid,
  nextPath,
}: {
  message: string;
  expectedReturnAt: string | null;
  overrideInvalid?: boolean;
  nextPath: string;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#07101f] px-6 text-center text-white">
      <Image src="/vyron-logo.svg" alt="VYRON CORE" width={160} height={40} className="h-10 w-auto" priority />

      <h1 className="mt-8 text-3xl font-black tracking-tight">We&apos;ll be right back</h1>
      <p className="mt-4 max-w-md text-sm text-white/70">
        {message || "VYRON CORE is undergoing scheduled maintenance. Thank you for your patience."}
      </p>

      {expectedReturnAt ? (
        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-cyan-400">
          Expected back: {new Date(expectedReturnAt).toLocaleString()}
        </p>
      ) : null}

      <p className="mt-8 text-xs text-white/50">
        Need urgent help? Contact <a href="mailto:support@vyron.app" className="underline">support@vyron.app</a>
      </p>

      <form method="POST" action="/api/platform/maintenance-override" className="mt-10 flex items-center gap-2">
        <input type="hidden" name="next" value={nextPath} />
        <input
          type="password"
          name="code"
          placeholder="Emergency override code"
          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white placeholder:text-white/40 outline-none"
        />
        <button type="submit" className="rounded-full bg-white px-4 py-2 text-xs font-black text-[#06101f]">
          Enter
        </button>
      </form>
      {overrideInvalid ? <p className="mt-2 text-xs text-rose-400">Invalid override code.</p> : null}
    </div>
  );
}
