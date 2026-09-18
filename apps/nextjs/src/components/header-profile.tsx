"use client";

import { HeaderSlot } from "./header-slot";

/**
 * The candidate's identity in the top-right of the header, in place of the
 * marketing badge. Rendered by a page (which knows the candidate) but shown up
 * in the shared header via a portal into the slot the header leaves for it.
 *
 * The portal itself lives in `HeaderSlot`, which is also what keeps this from
 * tripping a hydration mismatch — see the note there.
 */
export function HeaderProfile({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <HeaderSlot id="candidate-header-slot">
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
      </div>
    </HeaderSlot>
  );
}
