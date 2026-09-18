"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Render into a slot the shared header leaves behind.
 *
 * The header lives in the layout, above the page in the tree, so a page that
 * knows something the header should show — the candidate's name, the language
 * they are being interviewed in — has no clean prop path to it. A portal into
 * a server-rendered slot is that path.
 *
 * `useSyncExternalStore` is doing real work here, not ceremony. Reading the
 * slot during render behind a `typeof document` check is a server/client
 * branch: the server renders nothing, the client's FIRST render produces the
 * portal, and React reports a hydration mismatch and throws away the whole
 * page tree to re-render it. On the interview screen that is not cosmetic —
 * regenerating the tree remounts the interview, whose cleanup releases the
 * camera and microphone, leaving the candidate on a live question that
 * records nothing until they reload.
 *
 * This returns the server snapshot (false) during SSR *and* during hydration,
 * so both renders agree, then re-renders with the client snapshot once
 * mounted. No effect, no setState, no mismatch.
 */
export function HeaderSlot({
  id,
  children,
}: {
  /** DOM id of the placeholder the header rendered. */
  id: string;
  children: ReactNode;
}) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const slot = hydrated ? document.getElementById(id) : null;
  if (!slot) return null;

  return createPortal(children, slot);
}
