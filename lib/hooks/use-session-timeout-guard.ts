"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SESSION_TIMEOUT_WARNING_SECONDS } from "@/lib/server/session-validation";

const POLL_INTERVAL_MS = 30_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;

export type SessionTimeoutWarningState = {
  secondsRemaining: number;
  reason: "idle" | "absolute";
};

type HeartbeatSession = {
  secondsUntilIdleTimeout: number;
  secondsUntilAbsoluteTimeout: number;
} | null;

/** Phase 1C Task 2 — idle/absolute session timeout with a warning before auto-logout.
 * Polls /api/session/heartbeat, which reuses the same session-validity check every
 * authenticated API route already goes through (see lib/server-api-auth.ts). */
export function useSessionTimeoutGuard(params: {
  enabled: boolean;
  onExpired: () => void;
}): {
  warning: SessionTimeoutWarningState | null;
  stayLoggedIn: () => void;
} {
  const { enabled, onExpired } = params;
  const [warning, setWarning] = useState<SessionTimeoutWarningState | null>(null);
  const activeSinceLastTickRef = useRef(true);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!enabled) {
      setWarning(null);
      return;
    }

    const onActivity = () => {
      activeSinceLastTickRef.current = true;
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    let cancelled = false;

    async function tick() {
      const active = activeSinceLastTickRef.current;
      activeSinceLastTickRef.current = false;

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;

      try {
        const response = await fetch("/api/session/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ active }),
        });

        if (cancelled) return;

        if (response.status === 401) {
          onExpiredRef.current();
          return;
        }
        if (!response.ok) return;

        const payload = (await response.json()) as { session?: HeartbeatSession };
        const session = payload.session;
        if (!session) {
          setWarning(null);
          return;
        }

        if (session.secondsUntilIdleTimeout <= 0 || session.secondsUntilAbsoluteTimeout <= 0) {
          onExpiredRef.current();
          return;
        }

        if (session.secondsUntilIdleTimeout <= SESSION_TIMEOUT_WARNING_SECONDS) {
          setWarning({ secondsRemaining: session.secondsUntilIdleTimeout, reason: "idle" });
        } else if (session.secondsUntilAbsoluteTimeout <= SESSION_TIMEOUT_WARNING_SECONDS) {
          setWarning({ secondsRemaining: session.secondsUntilAbsoluteTimeout, reason: "absolute" });
        } else {
          setWarning(null);
        }
      } catch {
        /* transient network failure — try again next tick */
      }
    }

    void tick();
    const interval = window.setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
    };
  }, [enabled]);

  const stayLoggedIn = useCallback(() => {
    activeSinceLastTickRef.current = true;
    setWarning(null);
  }, []);

  return { warning, stayLoggedIn };
}
