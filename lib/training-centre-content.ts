/** Shared Training Centre curriculum — used by Training Centre and Pilot Readiness. */

export type TrainingArticle = {
  id: string;
  title: string;
  body: string;
};

export type TrainingSection = {
  id: string;
  title: string;
  articles: TrainingArticle[];
};

export const TRAINING_SECTIONS: TrainingSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    articles: [
      {
        id: "welcome",
        title: "Welcome to VYRON CORE",
        body: "Sign in with your company invite, select your workspace, and open the Command Centre for today's priorities.",
      },
      {
        id: "company-store-setup",
        title: "Company & store setup",
        body: "Owners complete Company Setup, add stores/sites, then import or add employees before enabling clocking and leave.",
      },
    ],
  },
  {
    id: "employees",
    title: "Employees",
    articles: [
      {
        id: "adding-staff",
        title: "Adding staff",
        body: "Use Employees or Import Staff. Assign employee numbers, stores, and roles. Set kiosk PINs for clocking and leave kiosks.",
      },
      {
        id: "hr-files",
        title: "HR files",
        body: "Warnings, cases, and documents live under HR modules. Always verify the correct employee before saving.",
      },
    ],
  },
  {
    id: "clocking",
    title: "Clocking",
    articles: [
      {
        id: "employee-clocking",
        title: "Employee clocking",
        body: "Open Clocking from the sidebar or deploy /clock?company=YOUR_ID on a shared tablet. Employees select their name and clock in/out.",
      },
      {
        id: "review-exceptions",
        title: "Review & exceptions",
        body: "Managers use Clock Review and Exceptions to resolve missing events before payroll prep.",
      },
    ],
  },
  {
    id: "leave",
    title: "Leave",
    articles: [
      {
        id: "leave-kiosk",
        title: "Employee leave kiosk",
        body: "Deploy /leave?company=YOUR_ID for self-service applications. Managers approve in Leave Management.",
      },
      {
        id: "leave-balances",
        title: "Balances",
        body: "Leave balances accrue per policy. Check Leave Management before approving long annual leave blocks.",
      },
    ],
  },
  {
    id: "field-ops",
    title: "Field Operations",
    articles: [
      {
        id: "job-visits",
        title: "Job visits",
        body: "Create jobs in Job Visits, assign employee, vehicle, trailer, and asset. Dispatch to field mobile workflow.",
      },
      {
        id: "mobile-workflow",
        title: "Mobile workflow",
        body: "Technicians use Field Mobile: Start Day → Travel → Arrive Site → Complete Job → End Day. Photos and GPS are captured automatically.",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    articles: [
      {
        id: "reports-centre",
        title: "Reports Centre",
        body: "Export payroll, attendance, and compliance reports from Reports Centre. Filter by date and store.",
      },
      {
        id: "intelligence-dashboards",
        title: "Intelligence dashboards",
        body: "Travel, cost, risk, vehicle, and profitability intelligence layers summarise operational margin and leakage.",
      },
    ],
  },
  {
    id: "payroll",
    title: "Payroll",
    articles: [
      {
        id: "payroll-prep",
        title: "First payroll run",
        body: "Confirm rosters exist, clock events are captured, then open Payroll Prep to generate hours. Clear exceptions before approving rows.",
      },
      {
        id: "payroll-export",
        title: "Export payroll pack",
        body: "Approve clean payroll rows, then export the payroll CSV pack for your external payroll system.",
      },
    ],
  },
];

export function listAllTrainingArticleIds(): string[] {
  return TRAINING_SECTIONS.flatMap((section) => section.articles.map((a) => a.id));
}

export function countTrainingArticles(): number {
  return listAllTrainingArticleIds().length;
}
