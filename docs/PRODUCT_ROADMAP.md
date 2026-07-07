# VYRON CORE Product Roadmap

This document is the engineering roadmap for VYRON CORE.

Purpose split:
- AGENTS.md defines how we build.
- PRODUCT_ROADMAP.md defines what we are building.

## Vision
Build the operating system for workforce operations: a platform that does not only record events, but improves decisions, execution quality, and business outcomes daily.

## Mission
Deliver an enterprise-grade workforce platform that:
- Unifies workforce execution data across HR, attendance, leave, rostering, payroll readiness, and compliance.
- Converts operational signals into actionable decisions.
- Improves readiness, reduces leakage, and increases managerial effectiveness.

## Product Philosophy
- Operational decisions over passive reporting.
- Measurable business impact over feature parity.
- Reuse and extension over duplication.
- Enterprise reliability and auditability by default.
- Intelligence embedded in workflows, not bolted on.

## Core Design Principles
- Single source of truth per domain table.
- No duplicate pages for existing domains; extend active modules.
- Keep authentication and authorization stable unless explicitly planned.
- Migrations must be deterministic, idempotent, and dependency-aware.
- Intelligence outputs must be structured and action-ready.
- Every major decision feature must expose owner, status, and expected outcome.

## Platform Architecture
- Frontend: Next.js app router with centralized shell routing and module panels.
- Data Platform: Supabase (Postgres, RLS, policy-governed access, RPC where required).
- Intelligence Layer: reusable analytics engines in lib/ and API aggregators in app/api.
- Operational Modules: employee, clocking, leave, roster, payroll, HR cases, warnings, documents.
- Decision Layer: structured insights, action prioritization, risk ranking, executive summaries.

## Completed Modules
- Employee Management: Production Ready
- Clocking and Attendance Core: Production Ready
- Leave Management Excellence: Production Ready
- Rostering and Shift Planning Excellence: Production Ready
- Payroll Readiness and Workforce Validation: Production Ready
- HR Cases and Warnings Operational Layer: Production Ready
- Documents and Employee File Workflows: Production Ready
- Migration Reliability Baseline and Manifest: In Development
- Workforce Intelligence Engine Phase 1: In Development

## Modules In Progress
- Workforce Intelligence Engine (Phase 1 hardening): In Development
- Executive Intelligence decision surfaces: In Development
- Action Intelligence ranking and ownership routing: Planning
- Production migration automation validation path: In Development

## Planned Modules
- Enterprise Device Integration layer and vendor connectors: Planning
- Executive dashboard suite (CEO/COO/Operations/Payroll/Compliance): Planning
- AI Workforce Intelligence Phase 2 (advanced predictions): Planning
- Decision automation and closed-loop outcome tracking: Planning

## Future Modules
- Autonomous Workforce Operations engine: Not Started
- Continuous learning and policy feedback loops: Not Started
- Self-optimizing labor allocation engine: Not Started
- Cross-tenant benchmarking intelligence (privacy-safe): Not Started

## Integration Roadmap
- V1.1 device integrations:
  - ZKTeco: Planning
  - Hikvision: Planning
  - Suprema: Planning
  - Impro: Planning
  - Matrix: Planning
  - Anviz: Planning
  - Biometric abstraction layer: Planning
- Payroll export integrations hardening: In Development
- Enterprise API/webhook framework for external systems: Planning

## AI Roadmap
- Phase 1 (current): rule-driven intelligence and decision scaffolding from operational data (no chat dependency): In Development
- Phase 2: predictive intelligence (burnout, retention, attendance, leave forecasts): Planning
- Phase 3: decision automation with measurable outcome loops: Planning
- Phase 4: autonomous optimization with human governance controls: Not Started

## Release Roadmap

### V1.0 - Enterprise Workforce Platform
Target: stabilize the full operational baseline and intelligence foundation.

Capabilities:
- Employee Management: Production Ready
- Clocking: Production Ready
- Leave: Production Ready
- Rostering: Production Ready
- Payroll Readiness: Production Ready
- HR Cases: Production Ready
- Documents: Production Ready
- Intelligence Engine: In Development
- Action Intelligence: Planning

Release status: In Development

### V1.1 - Enterprise Device Integration
Target: connect major biometric/attendance ecosystems through one abstraction layer.

Capabilities:
- ZKTeco: Planning
- Hikvision: Planning
- Suprema: Planning
- Impro: Planning
- Matrix: Planning
- Anviz: Planning
- Biometric abstraction layer: Planning

Release status: Planning

### V1.2 - Executive Intelligence
Target: role-specific executive command dashboards and daily operational briefings.

Capabilities:
- CEO Dashboard: Planning
- COO Dashboard: Planning
- Operations Dashboard: Planning
- Payroll Dashboard: Planning
- Compliance Dashboard: Planning
- Executive Morning Briefing: Planning

Release status: Planning

### V1.3 - AI Workforce Intelligence
Target: predictive workforce risk and optimization intelligence.

Capabilities:
- Labour Leakage: In Development
- Burnout Prediction: Planning
- Retention Prediction: Planning
- Attendance Forecasting: Planning
- Leave Forecasting: Planning
- Workforce Health: In Development
- Operational Recommendations: In Development

Release status: Planning

### V2.0 - Autonomous Workforce Operations
Target: continuous decision and execution automation with measurable gains.

Capabilities:
- Workflow Automation: Planning
- Decision Automation: Planning
- Continuous Learning: Not Started
- Self-Optimising Workforce Engine: Not Started

Release status: Planning

## Feature Status Matrix

### Status legend
- Not Started
- Planning
- In Development
- Testing
- Production Ready

### Major capability status
| Capability | Status |
|---|---|
| Employee Management | Production Ready |
| Clocking | Production Ready |
| Leave Management | Production Ready |
| Rostering | Production Ready |
| Payroll Readiness | Production Ready |
| HR Cases | Production Ready |
| Documents | Production Ready |
| Intelligence Engine | In Development |
| Action Intelligence | Planning |
| Executive Intelligence | Planning |
| Device Integration | Planning |
| Decision Automation | Planning |
| Autonomous Workforce Operations | Not Started |

## Production Readiness Snapshot
These are rolling engineering estimates and must be updated each sprint.

| Metric | Current Estimate |
|---|---|
| Overall Product Completion % | 72% |
| Operational Readiness % | 80% |
| Enterprise Readiness % | 67% |
| AI Readiness % | 48% |
| Integration Readiness % | 34% |

## Governance
- This file is the master roadmap for VYRON CORE.
- Every future sprint must update this roadmap.
- Do not duplicate AGENTS.md directive content here.
- Keep roadmap scope, status, and readiness percentages current.
