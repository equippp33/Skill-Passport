"use client";

import { useState } from "react";
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
  // The slot is server-rendered by the header, so it is already in the DOM at
  // hydration — read it once rather than round-tripping through an effect.
  const [slot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : document.getElementById("candidate-header-slot"),
  );

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
