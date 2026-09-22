"use client";

import { useMemo, useState } from "react";
import { plans } from "@/lib/marketing/site";
import p from "./umora/pages.module.css";

const planThresholds = [20, 50, 100, 250, 500];

function pickPlanIndex(size: number): number {
  const idx = planThresholds.findIndex((limit) => size <= limit);
  return idx === -1 ? plans.length - 1 : idx;
}

export default function PricingEstimator() {
  const [teamSize, setTeamSize] = useState(80);
  const selectedPlan = useMemo(() => plans[pickPlanIndex(teamSize)], [teamSize]);

  return (
    <section className={p.estimator} aria-labelledby="pricing-estimator-heading">
      <div>
        <p className={p.cardEyebrow}>Interactive plan guide</p>
        <h3 id="pricing-estimator-heading" className={p.planName}>
          Which package fits your team?
        </h3>
        <p className={p.cardText} style={{ marginTop: "0.5rem" }}>
          Drag to estimate the right package for your workforce size. Final commercial terms can be tailored during a
          demo.
        </p>
        <label htmlFor="team-size" className={p.estimatorLabel} style={{ marginTop: "1.2rem" }}>
          Estimated employees: {teamSize}
        </label>
        <input
          id="team-size"
          type="range"
          min={5}
          max={800}
          value={teamSize}
          onChange={(event) => setTeamSize(Number(event.target.value))}
          className={p.range}
        />
      </div>

      <div className={p.estimatorResult} aria-live="polite">
        <p className={p.estimatorKicker}>Recommended package</p>
        <p className={p.planName}>{selectedPlan.name}</p>
        <p className={p.planPrice} style={{ color: "#fff", marginTop: "0.5rem" }}>
          {selectedPlan.price}
        </p>
        <p style={{ marginTop: "0.3rem", color: "#cfd8de" }}>{selectedPlan.people}</p>
      </div>
    </section>
  );
}
