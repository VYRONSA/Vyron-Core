"use client";
import React from "react";
import { AlertTriangle, BarChart3, Brain, ShieldCheck, WalletCards } from "lucide-react";
export default function ExecutiveCommandCentreFinal({ exceptions=[], hrCases=[], payrollHours=[] }: any) {
  const openExceptions=exceptions.filter((e:any)=>e.status!=="closed"&&e.status!=="approved").length;
  const openHrCases=hrCases.filter((h:any)=>h.status!=="closed").length;
  const payrollBlocked=payrollHours.filter((p:any)=>p.status==="needs_review"||Number(p.missing_clock_events||0)>0).length;
  const estimatedLoss=openExceptions*1200+openHrCases*2500+payrollBlocked*900;
  const riskScore=Math.min(100,openExceptions*8+openHrCases*12+payrollBlocked*10);
  return <section className="space-y-6"><div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl"><div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">EXECUTIVE COMMAND</div><h1 className="mt-3 text-4xl font-black">VYRON CORE Control Wall</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">One screen for workforce risk, HR exposure, payroll blockers and operating leakage.</p></div><div className="grid gap-5 md:grid-cols-5"><Metric icon={<Brain/>} label="Risk score" value={`${riskScore}%`} danger={riskScore>50}/><Metric icon={<AlertTriangle/>} label="Open exceptions" value={openExceptions} danger={openExceptions>0}/><Metric icon={<ShieldCheck/>} label="Open HR cases" value={openHrCases} danger={openHrCases>0}/><Metric icon={<WalletCards/>} label="Payroll blockers" value={payrollBlocked} danger={payrollBlocked>0}/><Metric icon={<BarChart3/>} label="Est. leakage" value={`R${estimatedLoss.toLocaleString("en-ZA")}`} danger={estimatedLoss>0}/></div></section>
}
function Metric({icon,label,value,danger}:any){return <div className={`rounded-[28px] p-6 shadow-lg ${danger?"bg-rose-50 text-rose-800":"bg-white text-slate-950"}`}><div>{icon}</div><div className="mt-4 text-3xl font-black">{value}</div><div className="text-sm font-bold opacity-70">{label}</div></div>}
