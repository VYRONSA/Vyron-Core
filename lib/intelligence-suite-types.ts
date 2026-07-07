/** Client-safe Stage 2 intelligence result shapes (no engine implementation). */

export interface LeakageEngineResult {
  totalLeakageZAR: number;
  leakageByBranch: Record<string, number>;
  leakageByManager: Array<{ managerKey: string; leakageZAR: number }>;
}

export interface BuddyAlert {
  incidentId: string;
  employeeA: string;
  employeeB: string;
  anchorTime: string;
  reason: "device" | "ip" | "gps";
}

export interface BuddyClockingGuardResult {
  buddyClockingSuspicionScore: number;
  activeBuddyAlerts: BuddyAlert[];
  repeatOffenders: Array<{ employeeId: string; incidentCount: number }>;
}

export interface OverstaffedShift {
  rosterShiftId: string;
  storeId: string | null;
  shiftDate: string;
  rosterHeadcount: number;
  uniqueClockIns: number;
  overrunPct: number;
  wastedHoursEstimate: number;
  wastedLaborZAR: number;
}

export interface OptimizationEngineResult {
  optimizationIndex: number;
  overstaffedShifts: OverstaffedShift[];
  laborSavingsOpportunitiesZAR: number;
}

export interface BurnoutAlert {
  employeeId: string;
  name: string;
  department: string;
  riskFactor: string;
}

export interface BurnoutPredictorResult {
  globalBurnoutIndex: number;
  highRiskEmployeeAlerts: BurnoutAlert[];
}

export interface IntelligenceInsight {
  id: string;
  domain:
    | "labour_leakage"
    | "attendance"
    | "leave"
    | "roster"
    | "payroll"
    | "workforce_health"
    | "department_health"
    | "manager_scorecard"
    | "executive";
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  businessImpact: string;
  recommendedAction: string;
  relatedEmployees: string[];
  relatedDepartment: string | null;
  status: "open" | "in_progress" | "resolved";
  owner: string | null;
  whatHappened: string;
  whyItHappened: string;
  costToBusinessZAR: number;
  whatShouldHappenNext: string;
  whoShouldDoIt: string;
  ifNothingIsDone: string;
  autoPreparation: {
    canPrepare: boolean;
    preparedWork: string[];
  };
  measurableValue: string;
}

export interface LabourLeakageIntelligence {
  estimatedLabourLeakageZAR: number;
  repeatedLateArrivals: number;
  unapprovedOvertime: number;
  missingClockEvents: number;
  excessiveAbsenteeism: number;
  duplicateCorrections: number;
  highOvertimeDepartments: Array<{ department: string; overtimeHours: number; employeeCount: number }>;
  employeeRiskRanking: Array<{
    employeeId: string;
    name: string;
    department: string;
    riskScore: number;
    estimatedLeakageZAR: number;
    triggers: string[];
  }>;
  departmentRiskRanking: Array<{ department: string; riskScore: number; estimatedLeakageZAR: number }>;
}

export interface AttendanceIntelligence {
  attendancePct: number;
  punctualityPct: number;
  missedShiftPct: number;
  averageLatenessMinutes: number;
  trend: Array<{
    label: string;
    attendancePct: number;
    punctualityPct: number;
    missedShiftPct: number;
  }>;
  managerComparison: Array<{ manager: string; attendancePct: number; punctualityPct: number; riskCount: number }>;
  storeComparison: Array<{ storeId: string; attendancePct: number; punctualityPct: number; missedShiftPct: number }>;
  departmentComparison: Array<{ department: string; attendancePct: number; punctualityPct: number; missedShiftPct: number }>;
}

export interface LeaveIntelligence {
  leaveAbusePatterns: number;
  repeatedMondays: number;
  repeatedFridays: number;
  adjacentPublicHolidays: number;
  highLeaveDepartments: Array<{ department: string; leaveDays: number }>;
  seasonalTrends: Array<{ month: string; leaveDays: number }>;
  forecastShortages: Array<{ date: string; department: string; shortageEmployees: number }>;
}

export interface RosterIntelligenceSnapshot {
  scheduledHours: number;
  workedHours: number;
  varianceHours: number;
  coveragePct: number;
  utilisationPct: number;
  overstaffingHours: number;
  understaffingHours: number;
  overtimeFromRosterHours: number;
}

export interface PayrollIntelligenceSnapshot {
  readinessScore: number;
  blockerCount: number;
  recurringPayrollErrors: Array<{ type: string; count: number }>;
  repeatedManagers: Array<{ manager: string; issueCount: number }>;
  delayDepartments: Array<{ department: string; issueCount: number }>;
}

export interface WorkforceHealthEmployeeScore {
  employeeId: string;
  name: string;
  department: string;
  attendance: number;
  leave: number;
  warnings: number;
  hrCases: number;
  training: number;
  compliance: number;
  overtime: number;
  workload: number;
  overall: number;
  band: "Excellent" | "Good" | "Needs Attention" | "High Risk";
}

export interface DepartmentHealthScore {
  department: string;
  productivity: number;
  attendance: number;
  leave: number;
  compliance: number;
  training: number;
  warnings: number;
  cases: number;
  overall: number;
}

export interface ManagerScorecard {
  manager: string;
  attendancePerformance: number;
  leaveApprovalSpeed: number;
  exceptionResolution: number;
  payrollReadiness: number;
  compliance: number;
  overtimeManagement: number;
  teamHealth: number;
  overall: number;
}

export interface ExecutiveDashboardSnapshot {
  topRisks: Array<{ title: string; severity: string; impact: string }>;
  payrollReadiness: number;
  departmentsAtRisk: Array<{ department: string; riskScore: number }>;
  attendanceTrend: Array<{ label: string; value: number }>;
  labourLeakage: number;
  complianceScore: number;
  workforceHealth: number;
  recommendations: string[];
}

export interface WorkforceIntelligenceState {
  companyId: string;
  leakage: LeakageEngineResult;
  buddyClocking: BuddyClockingGuardResult;
  optimization: OptimizationEngineResult;
  burnout: BurnoutPredictorResult;
  labourLeakage: LabourLeakageIntelligence;
  attendance: AttendanceIntelligence;
  leave: LeaveIntelligence;
  roster: RosterIntelligenceSnapshot;
  payroll: PayrollIntelligenceSnapshot;
  workforceHealth: WorkforceHealthEmployeeScore[];
  departmentHealth: DepartmentHealthScore[];
  managerScorecard: ManagerScorecard[];
  executiveDashboard: ExecutiveDashboardSnapshot;
  insights: IntelligenceInsight[];
  computedAtIso: string;
}

export function emptyWorkforceIntelligenceState(companyId: string): WorkforceIntelligenceState {
  return {
    companyId: companyId || "—",
    leakage: { totalLeakageZAR: 0, leakageByBranch: {}, leakageByManager: [] },
    buddyClocking: {
      buddyClockingSuspicionScore: 0,
      activeBuddyAlerts: [],
      repeatOffenders: [],
    },
    optimization: {
      optimizationIndex: 100,
      overstaffedShifts: [],
      laborSavingsOpportunitiesZAR: 0,
    },
    burnout: { globalBurnoutIndex: 0, highRiskEmployeeAlerts: [] },
    labourLeakage: {
      estimatedLabourLeakageZAR: 0,
      repeatedLateArrivals: 0,
      unapprovedOvertime: 0,
      missingClockEvents: 0,
      excessiveAbsenteeism: 0,
      duplicateCorrections: 0,
      highOvertimeDepartments: [],
      employeeRiskRanking: [],
      departmentRiskRanking: [],
    },
    attendance: {
      attendancePct: 0,
      punctualityPct: 0,
      missedShiftPct: 0,
      averageLatenessMinutes: 0,
      trend: [],
      managerComparison: [],
      storeComparison: [],
      departmentComparison: [],
    },
    leave: {
      leaveAbusePatterns: 0,
      repeatedMondays: 0,
      repeatedFridays: 0,
      adjacentPublicHolidays: 0,
      highLeaveDepartments: [],
      seasonalTrends: [],
      forecastShortages: [],
    },
    roster: {
      scheduledHours: 0,
      workedHours: 0,
      varianceHours: 0,
      coveragePct: 0,
      utilisationPct: 0,
      overstaffingHours: 0,
      understaffingHours: 0,
      overtimeFromRosterHours: 0,
    },
    payroll: {
      readinessScore: 0,
      blockerCount: 0,
      recurringPayrollErrors: [],
      repeatedManagers: [],
      delayDepartments: [],
    },
    workforceHealth: [],
    departmentHealth: [],
    managerScorecard: [],
    executiveDashboard: {
      topRisks: [],
      payrollReadiness: 0,
      departmentsAtRisk: [],
      attendanceTrend: [],
      labourLeakage: 0,
      complianceScore: 0,
      workforceHealth: 0,
      recommendations: [],
    },
    insights: [],
    computedAtIso: "",
  };
}
