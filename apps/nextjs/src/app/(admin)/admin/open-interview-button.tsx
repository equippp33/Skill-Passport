import Link from "next/link";

import { buttonClasses } from "~/components/ui";

/**
 * The "Open" control on an interview row — a link to that interview's page.
 */
export function OpenInterviewButton({
  interviewId,
  interviewTitle,
}: {
  interviewId: string;
  /** Named on the link so screen readers hear which row it belongs to. */
  interviewTitle: string;
}) {
  return (
    <Link
      href={`/admin/interviews/${interviewId}`}
      aria-label={`Open ${interviewTitle}`}
      className={buttonClasses("secondary", "sm")}
    >
      Open
    </Link>
  );
}
