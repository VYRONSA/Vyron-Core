<!-- BEGIN:nextjs-agent-rules -->
# IMPORTANT PRODUCT DIRECTION

This sprint is NOT about building another workflow engine.
This sprint is about making VYRON CORE behave like an Operations Director.

Every recommendation must answer:
- What happened?
- Why did it happen?
- How much is it costing the business?
- What should happen next?
- Who should do it?
- What will happen if nothing is done?
- Can the system prepare the work automatically?

Every recommendation must have measurable business value.
Do not simply generate notifications.
Generate operational decisions.

# Supabase (production)

Active project URL and env guidance: **`ACTIVE_SUPABASE.md`** at repo root. Never use deprecated project `ujgnhcwertihoqjgaofn`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

==================================================
ACTION CARDS
==================================================

All action cards must be framed as operational decisions, not informational alerts.

==================================================
BUSINESS IMPACT ENGINE
==================================================

Every Action Card must calculate business impact.

Examples:
Late Arrival
- Estimated payroll leakage
- Estimated productivity loss
- Team impact
- Operational risk

Repeated Overtime
- Estimated overtime cost
- Fatigue risk
- Payroll impact

Leave Conflict
- Coverage impact
- Customer service risk

Compliance Failure
- Audit risk
- Legal risk
- Operational exposure

Every Action Card must include:
- Financial Impact
- Operational Impact
- Compliance Impact
- Priority Score

==================================================
ROOT CAUSE ENGINE
==================================================

Do not simply report events.
Determine WHY they happened.

Examples:
Repeated lateness
- Roster changed
- Supervisor scheduling issue
- Transport pattern

Repeated overtime
- Understaffed roster
- High absenteeism
- Poor planning

Leave conflicts
- Peak season
- Manager approval delay
- Insufficient staffing

Every Action Card should attempt to identify the most likely root cause using available operational data.

Display:
- Likely Root Cause
- Confidence
- Supporting Evidence

==================================================
ACTION PRIORITISATION
==================================================

Not every issue should have equal priority.

Calculate:
- Business Impact
- Financial Impact
- Compliance Risk
- People Risk
- Operational Risk
- Urgency

Generate:
- Critical
- High
- Medium
- Low

Automatically sort Action Centre accordingly.

==================================================
DECISION SUPPORT
==================================================

Every Action Card must contain:
- Recommended Decision
- Alternative Decision
- Expected Outcome
- Confidence Score

Example:
Attendance Issue
- Recommendation: Schedule counselling
- Alternative: Continue monitoring
- Expected Outcome: Reduced absenteeism
- Confidence: 91%

==================================================
CEO SUMMARY
==================================================

Extend Executive Intelligence.

Generate:
- Top 10 Issues
- Top 10 Opportunities
- Estimated Monthly Payroll Leakage
- Estimated Labour Savings
- Highest Performing Department
- Highest Risk Department
- Managers Requiring Attention
- Business Health Score
- Operational Readiness Score
- People Health Score

This should become the executive morning briefing.

Continue until VYRON CORE behaves like an experienced Operations Director that continuously analyses workforce data, explains business impact, recommends actions, measures outcomes, and helps management make better operational decisions every day.
<!-- END:nextjs-agent-rules -->
