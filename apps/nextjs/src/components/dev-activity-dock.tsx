"use client";

import { useEffect, useState } from "react";

import { DevActivityPanel } from "./dev-activity-panel";
import type { ActivityEvent } from "./dev-activity-panel";

/**
 * The provider readout, on the admin side.
 *
 * The interview page already receives this on its own status poll. Admin has
 * no such poll, so this fetches `/api/dev/activity` — which exists only in
 * development and only for an admin session — letting you watch which service
 * is serving an interview while a candidate sits it on another device.
 *
 * The whole component is behind `process.env.NODE_ENV` at its mount site, so
 * in a production bundle it is dead code and is never shipped.
 */

/** Slow enough not to be noise, fast enough to follow a live interview. */
const POLL_MS = 2000;

export function DevActivityDock() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  /** Dismissed with the panel's cross; comes back on reload. */
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (closed) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/dev/activity", {
          cache: "no-store",
        });
        if (!response.ok) return; // 404 outside development, or not an admin
        const data = (await response.json()) as { events?: ActivityEvent[] };
        if (!cancelled && data.events) setEvents(data.events);
      } catch {
        // A debugging aid must never surface an error of its own.
      }
    };

    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [closed]);

  if (closed) return null;

  return (
    <DevActivityPanel
      events={events}
      // No single attempt on admin: the panel runs its clock from the first
      // recorded call instead.
      startedAt={null}
      onClose={() => setClosed(true)}
    />
  );
}
