"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * The candidate's identity in the top-right of the header, in place of the
 * marketing badge. Rendered by a page (which knows the candidate) but shown up
 * in the shared header via a portal into the slot the header leaves for it.
 *
 * Portalled rather than prop-drilled because the header lives in the layout,
 * above the page in the tree — there is no clean prop path from the page that
 * has the name to the header that renders it.
 */
export function HeaderProfile({ name }: { name: string }) {
  /**
   * Whether hydration has finished.
   *
   * This used to read the slot during render, guarded by `typeof document`.
   * That is a server/client branch: the server rendered nothing, the client's
   * FIRST render produced the portal, and React reported a hydration mismatch
   * and threw away the whole page tree to re-render it. On the interview that
   * was not a cosmetic warning — regenerating the tree remounts
   * `ActiveInterview`, whose cleanup releases the camera and microphone, so
   * the candidate was left on a live question that recorded nothing until they
   * reloaded.
   *
   * `useSyncExternalStore` exists for exactly this: it returns the server
   * snapshot (false) during SSR *and* during hydration, so both renders agree,
   * then re-renders with the client snapshot (true) once mounted. No effect,
   * no setState, no mismatch. The store never changes, so the subscribe
   * callback has nothing to do.
   */
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  // The slot is server-rendered by the header, so it is in the DOM by the time
  // this runs — but only read it after hydration, never during it.
  const slot = hydrated
    ? document.getElementById("candidate-header-slot")
    : null;

  if (!slot) return null;

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return createPortal(
    <div className="flex items-center gap-2.5 rounded-full border border-border-subtle bg-surface py-1 pr-3.5 pl-1">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-contrast"
      >
        {initial}
      </span>
      <span className="max-w-40 truncate text-sm font-medium text-content">
        {name}
      </span>
    </div>,
    slot,
  );
}
