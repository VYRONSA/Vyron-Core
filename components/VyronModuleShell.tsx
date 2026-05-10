"use client";

export default function VyronModuleShell({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="rounded-[34px] bg-[#06101f] p-6 text-white shadow-2xl">
        <div className="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">{label}</div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">{title}</h1>
      </div>
      {children}
    </section>
  );
}
