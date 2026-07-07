"use client";
import React, { useMemo } from "react";
import { CalendarDays, ShieldCheck, Store, Users, Zap } from "lucide-react";
import {
	complianceFlags,
	coverageGaps,
	detectLeaveCollisions,
	findRosterConflicts,
	payrollReadiness,
	type ClockEventLite,
	type CoverageRequirementLite,
	type LeaveRequestLite,
	type RosterRuleLite,
	type RosterShiftLite,
} from "@/lib/roster-enterprise";

export default function RosterIntelligencePanel({
	employees = [],
	stores = [],
	rosterShifts = [],
	leaveRequests = [],
	clockEvents = [],
	coverageRequirements = [],
	rosterRules = [],
}: {
	employees?: Array<{ id: string; active?: boolean }>;
	stores?: Array<{ id: string }>;
	rosterShifts?: RosterShiftLite[];
	leaveRequests?: LeaveRequestLite[];
	clockEvents?: ClockEventLite[];
	coverageRequirements?: CoverageRequirementLite[];
	rosterRules?: RosterRuleLite[];
}) {
	const activeEmployees = useMemo(() => employees.filter((employee) => employee.active !== false), [employees]);
	const scheduledEmployees = useMemo(() => new Set(rosterShifts.map((shift) => shift.employee_id)).size, [rosterShifts]);
	const coverageScore = activeEmployees.length ? Math.round((scheduledEmployees / activeEmployees.length) * 100) : 0;

	const overlaps = useMemo(() => findRosterConflicts(rosterShifts), [rosterShifts]);
	const leaveConflicts = useMemo(() => detectLeaveCollisions(rosterShifts, leaveRequests), [rosterShifts, leaveRequests]);
	const defaultRule: RosterRuleLite = rosterRules[0] || {
		minimum_rest_hours: 11,
		maximum_shift_hours: 12,
		maximum_consecutive_days: 6,
		maximum_weekly_hours: 45,
	};
	const compliance = useMemo(() => complianceFlags(rosterShifts, defaultRule), [rosterShifts, defaultRule]);
	const gaps = useMemo(() => coverageGaps(rosterShifts, coverageRequirements), [rosterShifts, coverageRequirements]);
	const readiness = useMemo(() => payrollReadiness(rosterShifts, clockEvents), [rosterShifts, clockEvents]);

	return (
		<section className="space-y-6">
			<div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
				<div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">ROSTER INTELLIGENCE</div>
				<h1 className="mt-3 text-4xl font-black">Shift Builder Command Centre</h1>
				<p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
					Workforce-ready intelligence across overlap conflicts, leave collisions, coverage gaps and payroll readiness.
				</p>
			</div>

			<div className="grid gap-5 md:grid-cols-3 xl:grid-cols-5">
				<Metric icon={<Users className="h-6 w-6" />} label="Active employees" value={activeEmployees.length} />
				<Metric icon={<Store className="h-6 w-6" />} label="Stores" value={stores.length} />
				<Metric icon={<CalendarDays className="h-6 w-6" />} label="Scheduled shifts" value={rosterShifts.length} />
				<Metric icon={<Zap className="h-6 w-6" />} label="Coverage score" value={`${coverageScore}%`} />
				<Metric icon={<ShieldCheck className="h-6 w-6" />} label="Payroll readiness" value={`${readiness.readiness_percent}%`} />
			</div>

			<div className="grid gap-5 xl:grid-cols-2">
				<Panel title="Compliance and Conflict Engine">
					<ListItem label="Overlapping shifts" value={overlaps.length} />
					<ListItem label="Leave collisions" value={leaveConflicts.length} />
					<ListItem label="Rule violations" value={compliance.length} />
				</Panel>

				<Panel title="Coverage and Payroll Readiness">
					<ListItem label="Coverage gaps" value={gaps.length} />
					<ListItem label="Matched clocked shifts" value={readiness.matched} />
					<ListItem label="Missing clocked shifts" value={readiness.missing} />
				</Panel>
			</div>
		</section>
	);
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
	return (
		<div className="rounded-[28px] bg-white p-6 shadow-lg">
			<div className="text-slate-900">{icon}</div>
			<div className="mt-4 text-4xl font-black">{value}</div>
			<div className="text-sm font-bold text-slate-500">{label}</div>
		</div>
	);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<article className="rounded-[28px] border border-white/80 bg-white/95 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.12)]">
			<h2 className="text-xl font-black text-slate-950">{title}</h2>
			<div className="mt-4 space-y-3">{children}</div>
		</article>
	);
}

function ListItem({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
			<span className="font-semibold text-slate-600">{label}</span>
			<span className="font-black text-slate-950">{value}</span>
		</div>
	);
}
