"use client";

import { useEffect } from "react";

/**
 * Guard the browser Back button (and tab close / refresh) during the
 * assessment, so a candidate cannot wander back out of the flow by accident
 * and lose their session.
 *
 * The trick is a history "guard" entry with the SAME url as the current page:
 * pressing Back pops to it without the Next router seeing a route change, which
 * fires `popstate` for us to intercept. We confirm, and either re-arm the guard
 * (stay) or step back for real (leave). Tab close / refresh is caught with the
 * native `beforeunload` prompt — the only dialog a browser allows there.
 */
export function PreventBackNavigation({
  message = "Leaving now will interrupt your interview and you may lose your progress. Are you sure you want to leave this page?",
}: {
  message?: string;
}) {
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);

    let leaving = false;
    const onPopState = () => {
      if (leaving) return;
      if (window.confirm(message)) {
        // Honour the request: stop guarding and let the Back through.
        leaving = true;
        window.removeEventListener("popstate", onPopState);
        window.history.back();
      } else {
        // Re-arm so the next Back press is caught too.
        window.history.pushState(null, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPopState);

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [message]);

  return null;
}
