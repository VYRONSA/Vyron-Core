"use client";

import { useMemo, useState } from "react";
import { plans } from "@/lib/marketing/site";
import styles from "./marketing.module.css";

const planThresholds = [20, 50, 100, 250, 500];

function pickPlanIndex(size: number): number {
  const idx = planThresholds.findIndex((limit) => size <= limit);
  return idx === -1 ? plans.length - 1 : idx;
}

export default function PricingEstimator() {
  const [teamSize, setTeamSize] = useState(80);
  const selectedPlan = useMemo(() => plans[pickPlanIndex(teamSize)], [teamSize]);

  return (
    <section className={styles.card} aria-labelledby="pricing-estimator-heading">
      <h3 id="pricing-estimator-heading">Interactive plan guide</h3>
      <p className={styles.muted}>
        Drag to estimate the right package for your workforce size. Final commercial terms can be customized
        during a demo.
      </p>

      <div style={{ marginTop: "1rem" }}>
        <label htmlFor="team-size" style={{ display: "block", fontWeight: 800 }}>
          Estimated employees: {teamSize}
        </label>
        <input
          id="team-size"
          type="range"
          min={5}
          max={800}
          value={teamSize}
          onChange={(event) => setTeamSize(Number(event.target.value))}
          style={{ width: "100%", marginTop: "0.7rem" }}
        />
      </div>

      <div className={styles.card} style={{ marginTop: "1rem", background: "rgba(241,247,255,0.9)" }}>
        <p style={{ margin: 0, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#245099" }}>
          Recommended package
        </p>
        <h4 style={{ marginTop: "0.35rem", marginBottom: "0.35rem" }}>{selectedPlan.name}</h4>
        <p style={{ margin: 0, fontWeight: 700 }}>{selectedPlan.price}</p>
        <p className={styles.muted} style={{ marginBottom: 0 }}>
          {selectedPlan.people}
        </p>
      </div>
    </section>
  );
}
