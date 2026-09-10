import Link from "next/link";

import { buttonClasses } from "~/components/ui";

/**
 * The "Open" control on an interview row.
 *
 * A link, not a button: which interview is open is a URL, so opening one is
 * a navigation the browser can go back to. That is also why this can stay a
 * server component — there is no state here to hold.
 */
export function OpenInterviewButton({
  interviewId,
  interviewTitle,
  basePath,
}: {
  interviewId: string;
  /** Named on the link so screen readers hear which row it belongs to. */
  interviewTitle: string;
  /** The list page this row is on; the dialog opens over it. */
  basePath: string;
}) {
  return (
    <Link
      href={`${basePath}?interview=${encodeURIComponent(interviewId)}`}
      aria-label={`Open ${interviewTitle}`}
      className={buttonClasses("secondary", "sm")}
      scroll={false}
    >
      Open
    </Link>
  );
}
