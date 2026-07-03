"use client";

import React from "react";

export default function VyronDevPanel({
  children,
  dark = false,
  className = "",
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <section
      className={
        dark
          ? `vyron-dark-panel relative overflow-hidden rounded-[34px] p-6 text-white before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_18%_8%,rgba(34,211,238,0.14),transparent_42%)] ${className}`
          : `vyron-panel rounded-[var(--vyron-radius-panel)] p-6 ${className}`
      }
    >
      {children}
    </section>
  );
}
