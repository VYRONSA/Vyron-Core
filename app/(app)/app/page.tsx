"use client";

import EmployeeApp from "@/components/mobile/EmployeeApp";

/**
 * The VYRON CORE Employee App.
 *
 * Deliberately rendered WITHOUT the desktop application shell: this is the
 * surface the native Android/iOS build loads, and a sidebar built for a 1440px
 * control room has no business on a phone that somebody is holding in the rain.
 */
export default function EmployeeAppPage() {
  return <EmployeeApp />;
}
