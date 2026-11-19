# South African Statutory Payroll & Working-Time Requirements — Reference for UMORA

> **Reference document — not legal advice. UMORA does not currently implement these rules and must not be described as statutorily compliant until they are implemented and independently verified.**

- **As of:** 2026-11-19
- **Prepared for:** UMORA pilot with Cutting Edge Cuisine (restaurant/catering, late shifts past midnight, Sunday and public-holiday work)
- **Purpose:** Requirements reference that a later implementation and an independent registered payroll practitioner will check against.
- **Status markers used below:** **[Verified]** = value read on an authoritative page/document listed in Sources. **[Not verified]** = could not be confirmed from a primary source during this research; must be checked before use.

**Important caveat about the Act text.** The BCEA text quoted here was read from the Department of Employment and Labour PDF of the Act (see Sources), which is the *as-enacted 1997 text*. The Act has since been amended (2002, 2013, 2018, and by court order in 2025 for parental leave). Sections 9–18, 20–23 and 31 summarised below appear substantively current, but the practitioner must check every section against a consolidated, up-to-date version.

---

## 1. Ordinary hours of work (BCEA s9, s11, s12)

**Rule (s9(1)).** An employer may not require or permit an employee to work more than 45 ordinary hours a week, and not more than **9 hours a day if the employee works ≤5 days a week**, or **8 hours a day if the employee works >5 days a week**.
- s9(2): by agreement, ordinary hours may be extended by up to **15 min/day, max 60 min/week**, for employees whose duties include *serving members of the public* (directly relevant to waitrons/front-of-house).
- s8: for ss9–11, a "day" is **24 hours measured from when the employee normally commences work** — not the calendar day. This matters for shifts crossing midnight.
- **s11 Compressed week:** written agreement may allow up to **12 hours/day (incl. meal intervals) without overtime pay**, but not >45 ordinary hours/week, not >10 h overtime/week, and not on >5 days/week.
- **s12 Averaging:** a *collective agreement* may average ordinary hours and overtime over up to **4 months** (average ≤45 ordinary h/week and ≤5 h overtime/week); lapses after 12 months (for the first two such agreements).

**Exclusions (s6).** Chapter 2 (working time) does not apply to senior managerial employees, travelling sales staff who regulate their own hours, employees working **<24 hours a month** for the employer, or (by s6(3) determination) employees earning above the **earnings threshold** for ss 9, 10, 11, 12, 14, 15, 16, 17(2), 18(3) (see §2).

**Worked example.** A line cook works a 6-day roster (Tue–Sun). Daily ordinary limit is 8 h; weekly 45 h. A 9.5 h shift on Friday = 8 h ordinary + 1.5 h overtime, even if the week totals <45 h.

**Edge cases.** Day-count per week changes week to week in hospitality rosters (5 vs 6 days changes the daily threshold). Split shifts (lunch + dinner). Shifts crossing midnight (use s8 "day").

**Data UMORA needs.** Days worked per week (actual and contracted); normal start time per employee (for s8 day boundaries); written agreements (s9(2) extension, s11 compressed week, s12 collective averaging); employee category flags (senior manager, <24 h/month); annual earnings vs threshold.

## 2. Overtime (BCEA s10) and the earnings threshold (s6(3))

**Rule.** Overtime only by **agreement**; max **3 h/day** and **10 h/week** (s10(1)); paid at **at least 1.5× wage** (s10(2)). Alternatives by agreement (s10(3)): ordinary wage + **30 min paid time off per OT hour**, or **90 min paid time off per OT hour**; time off must be granted within **1 month** (extendable to 12 months by written agreement) (s10(4)). An OT agreement concluded at commencement or in the first 3 months lapses after 1 year (s10(5)). s6(2): ss9, 10(1), 14(1), 15(1), 17(2), 18(1) do not apply to genuinely unforeseeable urgent work.

**Earnings threshold [Verified].** **R269 600.90 per annum** (≈ R22 466.74/month), effective **1 May 2026** — Government Notice No. 7384, Government Gazette No. 54544, 17 April 2026. Employees earning above it are excluded from ss 9, 10, 11, 12, 14, 15, 16, 17(2) and 18(3). "Earnings" = regular annual remuneration before deductions, **excluding** subsistence and transport allowances, achievement awards and **overtime payments**. Previous threshold: R261 748.45 from 1 April 2025 (secondary sources; gazette for 2025 not re-read).
- **Discrepancy:** the Department's media statement of 21 April 2026 states "R269 900.90". The gazette notice (the legal instrument) states **R269 600.90**. Use the gazette figure; flag to the practitioner.

**Worked example.** Waitron, R35.00/h, 5-day week (9 h/day limit). Thursday shift 11:00–23:00 with a 1 h meal interval = 11 h worked → 9 h ordinary + 2 h OT. OT pay = 2 × R35 × 1.5 = **R105.00**. If the same week already has 9 h OT, only 1 h more OT is lawful (10 h/week cap) — UMORA should flag the breach, not silently pay it.

**Edge cases.** Sunday hours of a non-Sunday worker don't count toward ordinary hours but *do* count toward the 10 h weekly OT cap (s16(4)). Threshold test uses annualised regular pay, not hourly × hours. Threshold changes mid-year (1 May 2026).

**Data UMORA needs.** Signed OT agreement + date; OT payment method (cash vs time off); TOIL balance and expiry; annual regular earnings excl. OT/allowances.

## 3. Meal intervals (s14) and rest periods (s15)

**Rule.**
- s14: an employee working **continuously for more than 5 hours** must get a meal interval of **≥1 continuous hour**; work is continuous unless interrupted by ≥60 min. Written agreement may reduce it to **≥30 min**, or dispense with it if the employee works **<6 hours** that day. The interval must be **paid** if the employee is required to work or be available during it, and any portion **beyond 75 minutes** is paid (unless the employee lives on the premises).
- s15: **daily rest ≥12 consecutive hours** between ending and recommencing work (reducible to 10 h by written agreement only for live-in employees whose meal interval is ≥3 h); **weekly rest ≥36 consecutive hours**, which must include Sunday unless otherwise agreed. Written agreement may allow 60 h every two weeks, or reduce weekly rest by up to 8 h if the next week is extended equivalently.

**Worked example.** Chef closes at 01:30 Sunday and is rostered to open at 10:00 Sunday → only 8.5 h rest → **s15 breach** (unless a lawful exception applies). A 7 h shift with only a 30 min break and no written agreement → s14 breach.

**Data UMORA needs.** Break start/end events (or rostered breaks); whether employee was "on call" during the break; written agreements reducing meal interval or rest; live-in flag.

## 4. Sunday work (s16)

**Rule.**
- Pay **2× wage** per hour worked on a Sunday, **unless the employee ordinarily works on a Sunday**, then **1.5×** (s16(1)).
- **Partial-shift guarantee (s16(2)):** if the employee works less than their ordinary shift and the s16(1) amount is less than the **ordinary daily wage**, pay the **ordinary daily wage**.
- **Time off (s16(3),(6)):** by agreement, paid time off equivalent to the difference between pay received and the s16 entitlement; granted within 1 month (extendable to 12 by written agreement).
- s16(4): Sunday hours of a non-Sunday worker are excluded from ordinary hours but counted for the weekly OT cap.
- **Cross-midnight (s16(5)):** a shift spanning Sunday and another day is deemed worked **entirely on Sunday**, unless the **greater portion** fell on the other day.

**Worked examples (R35/h, 8 h ordinary shift, ordinary daily wage R280).**
- Ordinarily works Sundays, 8 h: 8 × 35 × 1.5 = **R420**.
- Does not ordinarily work Sundays, 8 h: 8 × 35 × 2 = **R560**.
- Does not ordinarily work Sundays, called in for 3 h: 3 × 35 × 2 = R210 < R280 → pay **R280**.
- Saturday 18:00 → Sunday 02:00 (6 h Sat, 2 h Sun): whole shift is **Saturday**. Saturday 22:00 → Sunday 06:00 (2 h Sat, 6 h Sun): whole shift is **Sunday**.

**Edge cases.** "Ordinarily works on a Sunday" is not defined in the Act — needs a policy decision documented with the practitioner (contract terms / roster pattern). Interaction of Sunday premium with overtime on the same Sunday must be confirmed by the practitioner. Sunday that is also a public holiday (both rules; see §6).

**Data UMORA needs.** Per-employee flag "ordinarily works Sundays" (with effective dates); ordinary shift length and ordinary daily wage; Sunday time-off agreement and balance.

## 5. Night work (s17)

**Rule.**
- Night work = work **after 18:00 and before 06:00** the next day (s17(1)).
- Only **by agreement**, and only if the employee is compensated by an **allowance** (may be a shift allowance) **or reduced working hours**, and **transport is available** between residence and workplace at the start and end of the shift (s17(2)). The Act sets **no fixed allowance amount**.
- **Regular late-night work (s17(3),(4)):** an employee who works **more than one hour after 23:00 and before 06:00 at least 5 times per month or 50 times per year** works "on a regular basis". The employer must inform the employee in writing (in a language understood) of health and safety hazards and of the right to a medical examination; provide that examination at the employer's cost on request (before/soon after starting and at intervals); and transfer the employee to suitable day work if a night-work-related health condition arises and it is practicable.
- s26(2): pregnant employees and for 6 months after birth — employer must offer suitable alternative work if night work is required and practicable.

**Worked example.** A scullery worker finishing at 00:30 five times in November has worked >1 h after 23:00 on 5 occasions → "regular" night worker → s17(3) notices and medical examination rights apply. Hours 18:00–00:30 must attract the agreed night allowance or reduced hours.

**Data UMORA needs.** Night-work agreement; allowance type/rate (company policy); transport arrangement; counter of qualifying >1 h after-23:00 shifts per month/year; record that s17(3) notice was given; pregnancy flag (sensitive data — see §14).

## 6. Public holidays (Public Holidays Act 36 of 1994; BCEA s18)

**Rules.**
- Public Holidays Act: whenever a public holiday falls on a **Sunday, the following Monday is a public holiday** (stated on gov.za; attributed to s2(1)). A public holiday may be **exchanged for another day by agreement** (s2(2), per BCEA footnote). The President may declare additional holidays (s2A — used for 4 Nov 2026).
- BCEA s18(1): work on a public holiday only **by agreement**.
- s18(2) — holiday falls on a day the employee **would ordinarily work**:
  - **not worked:** at least the wage ordinarily received for that day;
  - **worked:** at least **double** that amount, **or if greater**, that amount **plus** the amount earned for time worked.
- s18(3) — holiday on a day the employee **would not ordinarily work**, but works: **ordinary daily wage + amount earned for the work performed**.
- s18(4): pay on the usual pay day. s18(5): cross-midnight shift deemed on the public holiday unless the **greater portion** fell on the other day.
- s20(8): a public holiday during annual leave, on a day ordinarily worked, gives an **extra day of leave**.
- s18(3) is excluded for employees above the earnings threshold; s18(1)–(2) are not.

**Public holiday dates [Verified against gov.za unless marked].**

| Date (2026) | Holiday | Date (2027) | Holiday |
|---|---|---|---|
| Thu 1 Jan | New Year's Day | Fri 1 Jan | New Year's Day |
| Sat 21 Mar | Human Rights Day | Sun 21 Mar | Human Rights Day |
| Fri 3 Apr | Good Friday | **Mon 22 Mar** | Human Rights Day observed |
| Mon 6 Apr | Family Day | Fri 26 Mar | Good Friday |
| Mon 27 Apr | Freedom Day | Mon 29 Mar | Family Day |
| Fri 1 May | Workers' Day | Tue 27 Apr | Freedom Day |
| Tue 16 Jun | Youth Day | Sat 1 May | Workers' Day |
| Sun 9 Aug | National Women's Day | Wed 16 Jun | Youth Day |
| **Mon 10 Aug** | National Women's Day observed | Mon 9 Aug | National Women's Day |
| Thu 24 Sep | Heritage Day | Fri 24 Sep | Heritage Day |
| **Wed 4 Nov** | Local Government Elections (declared under s2A; Presidency statement 15 Sep 2026 — not on gov.za list) | Thu 16 Dec | Day of Reconciliation |
| Wed 16 Dec | Day of Reconciliation | Sat 25 Dec | Christmas Day |
| Fri 25 Dec | Christmas Day | Sun 26 Dec | Day of Goodwill |
| Sat 26 Dec | Day of Goodwill | **Mon 27 Dec** | **Day of Goodwill observed — [Not verified]** |

**Discrepancy:** 26 December 2027 is a Sunday, so under the Sunday→Monday rule Monday 27 December 2027 should be a public holiday, but the gov.za 2027 list (as read on 2026-11-19) does **not** show it. Treat as a probable omission on the page; confirm before loading the 2027 calendar. Weekdays were computed independently. Saturday holidays do **not** roll over.

**Worked examples (R35/h, ordinary daily wage R280 for 8 h).**
- Freedom Day falls on a rostered day, not worked: pay **R280**.
- Worked 8 h: max(2 × 280 = 560; 280 + 280 = 560) = **R560**.
- Worked 10 h: max(560; 280 + 350 = 630) = **R630** (practitioner to confirm OT interaction for hours beyond the daily limit).
- Not a rostered day, called in for 5 h: 280 + 175 = **R455**.
- Shift 20:00 on 24 Dec → 04:00 on 25 Dec (4 h / 4 h): equal portions — the "greater portion" test does not resolve a tie; the default in s18(5) is that the whole shift counts as the public holiday. Practitioner to confirm.

**Data UMORA needs.** Maintained public-holiday calendar (incl. ad-hoc s2A declarations and observed Mondays) with effective dates; "would ordinarily work that day" determination per employee (roster pattern); ordinary daily wage; exchanged-holiday agreements.

## 7. Leave (BCEA s19–s27)

Chapter 3 does not apply to employees working **<24 hours a month** (s19).

- **Annual leave (s20–21):** annual cycle = 12 months from start. At least **21 consecutive days** on full pay per cycle, **or by agreement 1 day per 17 days worked/paid, or 1 hour per 17 hours worked/paid**. Must be granted within **6 months** after cycle end. No pay in lieu except on termination. Leave pay at the rate immediately before leave (s21, with s35). Extra day if a public holiday falls in leave on an ordinary work day (s20(8)).
  *Example:* casual waitron on the hourly accrual basis works 170 h in a month → accrues **10 h** annual leave.
- **Sick leave (s22–23):** 36-month cycle; paid sick leave equal to the days normally worked in **6 weeks** (5-day worker = 30 days; 6-day worker = 36 days per cycle). **First 6 months: 1 day per 26 days worked**. Pay = wage ordinarily received for that day. Employer need not pay without a **medical certificate** where absence is **>2 consecutive days** or on **>2 occasions in 8 weeks** and a certificate is requested (s23). Certificate from a medical practitioner or other registered person certified to diagnose and treat.
- **Family responsibility leave (s27):** employees employed **>4 months** who work **≥4 days a week**: **3 days' paid leave per annual leave cycle** when a child is sick, or on the death of specified family members. The original "when the employee's child is born" ground was removed by the Labour Laws Amendment Act 2018 with the introduction of parental leave **[Not verified against the amending Act text]**. Employer may require reasonable proof.
- **Maternity/parental (s25–25C) — summary only:** original s25 gives at least **4 consecutive months'** maternity leave (unpaid by employer unless contract says otherwise; benefits via UIF); no work for 6 weeks after birth unless certified fit. The 2018 amendments added parental (10 days), adoption and commissioning-parental leave. In **Van Wyk v Minister of Employment and Labour (Constitutional Court, 3 Oct 2025)** these provisions were declared unconstitutional and, per secondary reports, an interim reading-in allows the parental-leave allocation to be shared between parents pending legislation **[Not verified from the judgment text]**. Treat parental leave as **policy-driven and practitioner-confirmed**; UMORA should only record leave, not determine entitlement.

**Data UMORA needs.** Employment start date; leave-cycle dates; days/hours actually worked and paid (for 1:17 and 1:26 accruals); days normally worked per week; medical-certificate attachment and absence occurrence counter (8-week window); family responsibility usage per cycle.

## 8. Hospitality-specific position

- **Sectoral Determination 14: Hospitality Sector (GN R.437 of 2007, amended 2013 and 2016)** covers employers and employees in hospitality-sector activities. Its last published minimum wages (1 July 2018–30 June 2019: R17.34/h small employers, R19.35/h larger) are far **below the National Minimum Wage** and are therefore **obsolete for wage purposes**; the NMW applies. **[Verified via acts.co.za compilation, a secondary source]**
- **Current legal status is unresolved.** No repeal notice was found. In the National Minimum Wage Commission's December 2025 gazette (GG 53844) a stakeholder submission asks the Commission to state whether the forestry, hospitality and taxi determinations "are still in effect", adding that they "appear ... to have effectively ceased to exist". That is a submission, not a ruling. **Do not assume SD14 is either in force or repealed — practitioner/labour lawyer must confirm.**
- **SD14 provisions that would matter if still in force** (from the compiled text): minimum payment for **at least 4 hours** on any day an employee works fewer than 4 hours (cl. 2(3)); minimum wage measured **excluding gratuities/tips** (cl. 2(1)); "remuneration" excludes gratuities or gifts from customers (cl. 32); commission-work rules with employer make-up where commission falls short (cl. 3); uniform provisions (cl. 7B). Other parts cover hours, leave and termination.
- **Tips and service charges:** The NMW excludes tips, gratuities, allowances and payments in kind (Department statement, Feb 2026). No primary rule on ownership/distribution of tips or service charges was located; any tip-pooling or service-charge distribution should be governed by written policy and checked by the practitioner (also for PAYE treatment of tips paid through payroll).
- **Bargaining council:** **[Not verified]** — no hospitality/catering bargaining council coverage was confirmed during this research. If Cutting Edge Cuisine (or a client site it caters at) falls under a registered bargaining council agreement extended to non-parties, that agreement's wages and conditions override the BCEA minimums. Practitioner must check the Department's register of bargaining councils and any extended agreements by sector and area.

## 9. National Minimum Wage (NMW Act 9 of 2018)

**[Verified]** **R30.23 per ordinary hour**, effective **1 March 2026** (up from R28.79), announced by the Minister of Employment and Labour on 3 February 2026. Separate rate for EPWP workers: R16.62/h. Learnership allowances per Schedule 2 (not checked). The NMW **excludes** allowances (transport, tools, food, accommodation), payments in kind (board/lodging), **tips**, bonuses and gifts. Does not apply to SANDF, NIA, SASS members or unpaid volunteers.

*Example:* An employee paid R30.00/h fails the test even if tips take effective earnings to R60/h. A free staff meal does not count toward the NMW.

**Data UMORA needs.** Base hourly rate effective-dated; NMW rate table effective-dated; separation of tips/allowances from base pay.

## 10. PAYE — Employees' Tax (Income Tax Act, Fourth Schedule)

**Employer obligations.** Register as employer; deduct employees' tax from remuneration using SARS deduction tables (para 9(1)); pay over with an **EMP201** monthly declaration **within 7 days after month-end** (if the 7th is a weekend/public holiday, by the last business day before it); submit an **EMP501** reconciliation **twice a year** — interim (1 Mar–31 Aug) and annual (1 Mar–28/29 Feb) — by the dates SARS publishes; issue **IRP5** (tax deducted) / **IT3(a)** (no tax deducted) certificates. EMP501, IRP5s and EMP201s must reconcile. PAYE takes preference over non-statutory deductions (para 3). Records kept **5 years**.

**2027 tax year (1 Mar 2026 – 28 Feb 2027) [Verified, SARS].**

| Taxable income (R) | Tax |
|---|---|
| 0 – 245 100 | 18% |
| 245 101 – 383 100 | 44 118 + 26% above 245 100 |
| 383 101 – 530 200 | 79 998 + 31% above 383 100 |
| 530 201 – 695 800 | 125 599 + 36% above 530 200 |
| 695 801 – 887 000 | 185 215 + 39% above 695 800 |
| 887 001 – 1 878 600 | 259 783 + 41% above 887 000 |
| 1 878 601 + | 666 339 + 45% above 1 878 600 |

Rebates: primary **R17 820**, secondary (65+) **R9 765**, tertiary (75+) **R3 249**. Thresholds: **R99 000** (<65), **R153 250** (65+), **R171 300** (75+). Medical scheme fees tax credit: R376 (taxpayer), R376 (first dependant), R254 (each additional) per month.

**Methods (summary).** Standard employment (required to work ≥22 h/week): use SARS weekly/fortnightly/monthly tables per pay period, with the annual table applied at year end. Irregular items (bonuses, etc.) are commonly handled by annualising; the exact method must follow the SARS deduction-tables guide. **Non-standard employment** (casual daily-paid workers not deemed standard): **25%** flat rate. Deemed standard: works <22 h/week and declares no other employer, or works ≥5 h/day and earns **<R394/day**. Casual restaurant staff need correct classification.

*Example (simplified, no other deductions/credits):* monthly R10 000 → annualised R120 000 × 18% = R21 600 − R17 820 = R3 780/yr ≈ **R315/month**. Monthly R8 000 (R96 000/yr) is below the R99 000 threshold → **no PAYE**. Practitioner must validate against SARS tables.

**Data UMORA does not have:** tax numbers, age/date of birth for rebates, tax directives, fringe benefits, medical aid/retirement contributions, year-to-date totals, IRP5 source codes.

## 11. UIF (Unemployment Insurance Act 63 of 2001; UI Contributions Act 4 of 2002)

**[Verified, SARS]** **1% employee + 1% employer** of remuneration, capped at the earnings ceiling of **R17 712 per month (R212 544 per year), effective 1 June 2021** — still stated as current in the SARS 2027 employer guide. Maximum employee contribution **R177.12/month**. Exclusions include employees working **<24 hours a month** for the employer, national/provincial government employees, senior political office bearers, councillors and traditional leaders. Payment via **EMP201** with PAYE/SDL (due within 7 days after month-end). Separately, employers must register with the UIF and submit monthly **UI-19 employee declarations** to the Department of Employment and Labour (uFiling or the UI-19 form), including on termination; the UI-19 also supports employee benefit claims. Current uFiling operational status not confirmed.

*Example:* R10 000/month → R100 employee + R100 employer. R25 000/month → capped: R177.12 + R177.12.

## 12. SDL (Skills Development Levies Act 9 of 1999)

**[Verified, SARS]** **1% of total remuneration** (salaries, wages, overtime, leave pay, bonuses, commissions, lump sums). Employers whose leviable amount over the next 12 months will **not exceed R500 000** are exempt and need not register; certain public-sector bodies, qualifying PBOs and municipalities are also exempt. Paid monthly via **EMP201**, same deadline. Funds go to SETAs. *Example:* a R480 000 annual payroll is exempt; at R600 000 → R6 000/yr.

## 13. COIDA (Act 130 of 1993, as amended by Act 10 of 2022) — summary

Employer-funded (no employee deduction). Register with the Compensation Fund; submit an annual **Return of Earnings (ROE, form CF-2A/W.As 8)** declaring actual earnings for the past assessment year (1 Mar–28/29 Feb) and provisional earnings for the current year; the Fund issues an **assessment** at the industry tariff rate. The Act requires submission before 31 March or as communicated by the Commissioner — the **2025 ROE season ran 1 April–30 June 2026**, with a final reminder that returns not received **before 31 October 2026** may be estimated and penalised up to **10%** (s83(6)). **[Verified]** Maximum assessable earnings **R668 000 per employee per annum** and minimum assessment **R1 621** (domestic R560), effective **1 March 2026** (GN 3910, GG 54577, 24 April 2026). Prior year maximum shown on the ROE form: R633 168. Occupational injury absences are excluded from BCEA sick leave (s24).

## 14. Record-keeping and POPIA

- **BCEA s31:** keep for **3 years from the last entry**: employee name and occupation, **time worked**, **remuneration paid**, date of birth of under-18s, other prescribed information. No false entries. A s31 record satisfies other employment laws' time/pay record requirements. (Practitioner: also check prescribed BCEA regulations/forms and that edits to clock records are audit-logged.)
- **SARS:** payroll tax records 5 years (Tax Administration Act; SARS reconciliation page). UMORA should therefore not delete time records that feed payroll before 5 years without the client's documented decision.
- **POPIA (Act 4 of 2013) — summary:** attendance timestamps and GPS/location are personal information requiring a lawful basis, purpose limitation, minimality, security safeguards, retention limits and notice to employees. **Biometric information is special personal information** (s26) — processing is prohibited unless an exception in s27(1) applies (e.g. consent; necessary for establishment, exercise or defence of a right or obligation in law) or the Regulator authorises it (s27(2)). Health data (sick notes, pregnancy) is also special personal information. UMORA should: collect location only at clock events (not continuous tracking), document the lawful basis per data type, offer non-biometric alternatives, define retention aligned to the 3-/5-year rules, and support data-subject access requests. Section 33 (biometric authorisation) text not checked.

---

## Implications for UMORA

### (a) Rule-to-data coverage

Assumed current data: clock in/out timestamps, roster shifts (planned start/end), leave requests, employee `hourly_rate`; **no** tax/IRP5 data, **no** "ordinarily works Sundays" flag, **no** public-holiday calendar.

| Rule | Supportable today? | Missing data |
|---|---|---|
| s9 ordinary hours (daily/weekly) | **Partial** | Days-per-week basis, normal start time (s8 day), s9(2)/s11/s12 agreements, exclusion flags |
| s10 overtime calc & caps | **Partial** | OT agreement, TOIL option/balance, threshold earnings test |
| s6(3) threshold exclusion | **No** | Regular annual earnings (excl. OT/allowances), threshold table |
| s14 meal interval | **Partial** (only if breaks are clocked) | Break events, on-call flag, agreements |
| s15 daily/weekly rest | **Yes** (from clock/roster gaps) | Agreements for reduced rest; live-in flag |
| s16 Sunday pay | **No** | "Ordinarily works Sundays" flag, ordinary daily wage, time-off agreement |
| s17 night work | **Partial** (hours detectable) | Agreement, allowance policy, transport, s17(3) notice record |
| s18 public holidays | **No** | Holiday calendar, "would ordinarily work" determination, ordinary daily wage |
| Annual/sick/FRL leave accrual | **Partial** | Start date, cycle dates, accrual basis, certificates, occurrence counter |
| NMW check | **Yes** (hourly_rate vs table) | Effective-dated NMW table; separation of tips/allowances |
| PAYE | **No** | All tax data |
| UIF | **No** (rate known, no payroll) | Remuneration, exclusion flags, UIF reference, ID numbers |
| SDL | **No** | Total payroll, exemption status |
| COIDA | **No** | Annual earnings by employee, CF registration |
| s31 records (3 yrs) | **Partial** | Retention policy, immutable edit history |
| POPIA | **Partial** | Lawful-basis register, retention, consent/alternatives for biometrics |

### (b) Recommended boundary

**UMORA (time & attendance layer) should own *hours classification*, not money:**
- Produce, per employee per pay period, a classified, auditable hours ledger: ordinary, overtime (with cap breaches), Sunday hours (with ordinary/non-ordinary basis), public-holiday hours (worked / not worked on ordinary day / worked on non-ordinary day), night hours (18:00–06:00) and "regular after-23:00" counters, meal-interval and rest-period violations, leave taken and accrued (days/hours), and the s16(5)/s18(5) shift-attribution decision for cross-midnight shifts.
- Reasoning: these rules depend on timestamps, rosters, and calendars that UMORA already captures; errors there are operational (roster, rest, fatigue) and fit the Action Centre's "operational decision" framing (e.g. flag a rest-period breach before the shift starts). The ledger becomes the BCEA s31 "time worked" record.
- UMORA may show **indicative** cost estimates (hours × multiplier × base rate) for business-impact cards, clearly labelled as estimates, not payslip amounts.

**Payroll engine (dedicated, registered SA payroll software or bureau) should own *money and submissions*:**
- Gross pay finalisation (incl. ordinary-daily-wage guarantees, allowances, tips policy), PAYE (tables, rebates, directives, fringe benefits), UIF, SDL, ETI, COIDA earnings, EMP201/EMP501, IRP5/IT3(a), UI-19 declarations, and payslips.
- Reasoning: these require tax identity data, year-to-date state, annual SARS table updates and SARS/DEL submission channels; mistakes create statutory penalties; and the business owner requires independent verification. Building them inside UMORA would expand scope far beyond attendance and create a compliance claim UMORA cannot yet support.
- **Interface:** UMORA exports the classified hours ledger (per employee, per category, per date, with rule basis and source events) to the payroll engine; the payroll engine is the system of record for pay.

### (c) Verification steps for a registered payroll practitioner (before any compliance claim)

1. Confirm the employer's legal framework: BCEA only, or also a bargaining council agreement; confirm SD14 status for this employer.
2. Confirm each employee's category: above/below the earnings threshold (R269 600.90 from 1 May 2026), senior manager, <24 h/month, standard vs non-standard employment for PAYE.
3. Approve definitions: "ordinarily works on a Sunday", "would ordinarily work" on a public holiday, ordinary daily wage, normal start time (s8 day).
4. Review written agreements (OT, s9(2), s11, s12, meal-interval reduction, rest variation, night work, TOIL/Sunday time off, public-holiday exchange) and check UMORA's configuration matches them.
5. Validate the public-holiday calendar for 2026–2027, including 4 Nov 2026 and the 27 Dec 2027 question, and the process for future s2A declarations.
6. Run a test pack of real Cutting Edge Cuisine shifts through UMORA's classification (cross-midnight Saturday/Sunday, Sunday partial shifts, public holiday worked/not worked, 10 h OT cap, 12 h rest breach, after-23:00 counter) and reconcile by hand.
7. Reconcile UMORA's exported ledger against the payroll engine's payslips for at least one full pay cycle.
8. Verify NMW compliance of base rates excluding tips/allowances, effective-dated from 1 March 2026.
9. Confirm leave accrual bases (21 days vs 1:17 days vs 1:17 hours), sick-leave cycle start dates, first-6-months rule, and current parental-leave position after Van Wyk.
10. Confirm PAYE/UIF/SDL/COIDA are performed by the payroll engine with current SARS tables (2027 tax year), UIF ceiling R17 712, SDL threshold, and that EMP201/EMP501/UI-19/ROE filings are current.
11. Review record retention (3 years BCEA, 5 years SARS), audit trail of clock edits, and POPIA lawful basis for location and biometric data.
12. Re-verify all figures in this document against primary sources at the time of sign-off (they change annually: NMW 1 March, threshold ~April/May, tax tables 1 March, COIDA 1 March).

---

## Items not verified from a primary source

- 27 December 2027 public holiday (rule-derived; missing from gov.za list).
- Effect of Labour Laws Amendment Act 2018 on s25A–C and s27(2)(a); Van Wyk (2025) interim parental-leave regime.
- Current legal status of SD14 and applicable bargaining council coverage.
- Exact 2026/27 EMP501 submission windows (SARS states they are published per season) and IRP5 issue deadlines.
- uFiling current operational status; UI-19 submission channel.
- Previous (2025) BCEA threshold of R261 748.45 (secondary sources only).
- Public Holidays Act text (gov.za PDF is a scanned image; rule taken from gov.za public holidays page and BCEA footnote).
- POPIA s33 text.

## Sources (pages/documents opened)

- BCEA 75 of 1997 (as-enacted text, DEL): https://www.labour.gov.za/DocumentCenter/Acts/Basic%20Conditions%20of%20Employment/Act%20-%20Basic%20Conditions%20of%20Employment.pdf
- Earnings threshold determination, GN 7384, GG 54544, 17 Apr 2026: https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Notices/Basic%20Conditions%20of%20Employment/Basic%20Conditions%20of%20Employment%20Act_Determination%20Earnings%20Threshold2026.pdf
- DEL media statement on threshold (21 Apr 2026): https://www.labour.gov.za/Media-Desk/Media-Statements/Pages/Department-of-Employment-and-Labour-sets-a-new-threshold-in-the-protection-of-employees-.aspx
- NMW 2026 statement (3 Feb 2026): https://www.gov.za/news/media-statements/minister-nomakhosazana-meth-increases-statutory-national-minimum-wage-r3023
- NMW Commission notice, GG 53844, 11 Dec 2025: https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Notices/Basic%20Conditions%20of%20Employment/Investigation%20into%20the%20National%20Minimum%20Wage%20Invitation%20for%20written%20representations%20by%2012%20Jan%202026.pdf
- Public holidays (gov.za): https://www.gov.za/about-sa/public-holidays
- Election Day public holiday, 4 Nov 2026: https://www.gov.za/news/media-statements/president-cyril-ramaphosa-declares-election-day
- Public Holidays Act 36 of 1994 (scanned; not machine-readable): https://www.gov.za/sites/default/files/gcis_document/201409/act36of1994.pdf
- SARS rates of tax for individuals: https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/
- SARS Guide for Employers iro Employees' Tax (2027), PAYE-GEN-01-G21: https://www.sars.gov.za/wp-content/uploads/Ops/Guides/PAYE-GEN-01-G21-Guide-for-Employers-iro-Employees-Tax-for-2027-External-Guide.pdf
- SARS PAYE reconciliations: https://www.sars.gov.za/types-of-tax/pay-as-you-earn/reconciliations/
- SARS UIF: https://www.sars.gov.za/types-of-tax/unemployment-insurance-fund/
- SARS SDL: https://www.sars.gov.za/types-of-tax/skills-development-levy/
- COIDA max earnings / minimum assessment, GN 3910, GG 54577, 24 Apr 2026: https://www.gov.za/sites/default/files/gcis_document/202604/54577gen3910.pdf
- Compensation Fund ROE system notice (16 Mar 2026): https://www.labour.gov.za/DocumentCenter/Publications/Compensation%20for%20Occupational%20Injuries%20and%20Diseases/Notice%20of%20Temporary%20ROE%20Online%20Systems%20Shut-Down%20from%2019%20March%20to%2031%20March%202026.pdf
- COIDA final ROE reminder, GN 4140, GG 55347, 8 Sep 2026: https://www.gov.za/sites/default/files/gcis_document/202609/55347gen4140.pdf
- Information Regulator guidance note on special personal information (2021): https://inforegulator.org.za/wp-content/uploads/2020/07/InfoRegSA-GuidanceNote-Processing-SpecialPersonalInformation-20210628.pdf
- SD14 compiled text (secondary, acts.co.za): https://source.acts.co.za/basic-conditions-of-employment-act-1997/sd14_nr437_sectoral_determination_14__hos.php ; https://source.acts.co.za/basic-conditions-of-employment-act-1997/sd14_nr437_part_a_application.php ; https://source.acts.co.za/basic-conditions-of-employment-act-1997/sd14_nr437_2__minimum_wage_levels.php ; https://www.acts.co.za/basic/sd14_nr437_32__what_words_mean_in_this_determination

Opened but unreadable or blocked (not relied on): DEL hospitality leaflet (image-only PDF) https://www.labour.gov.za/DocumentCenter/Acts/Basic%20Conditions%20of%20Employment/-%20ES-%20What%20Hospitality%20Workers%20and%20their%20Employers%20should%20know%20about%20minimum%20wages%20and%20basic%20conditions%20of%20employment.pdf ; https://labourguide.co.za/employment-condition/important-update-increase-in-basic-conditions-of-employment-act-earnings-threshold-for-2026 (403) ; https://polity.org.za/article/important-update-increase-in-basic-conditions-of-employment-act-earnings-threshold-for-2026-2026-04-21 (403) ; https://webberwentzel.com/News/Pages/new-earnings-threshold-takes-effect-1-may-2026.aspx (title only) ; https://www.webberwentzel.com/News/Pages/the-landmark-parental-leave-judgment-cementing-all-classes-of-parents-as-equal-participants-in-their-childrens-lives.aspx (title only) ; https://www.labour.gov.za/DocumentCenter/Publications/Unemployment%20Insurance%20Fund/UIF%20frequently%20asked%20questions.pdf (too large to fetch).
