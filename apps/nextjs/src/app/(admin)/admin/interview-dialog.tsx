"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { EmptyState, StatusBadge, buttonClasses } from "~/components/ui";
import { Modal } from "~/components/modal";
import type { TranslatedLanguageKey } from "~/config/languages";
import { getMessages } from "~/config/messages";
import type { InterviewDetails } from "~/server/admin/dto";
import { formatSpokenLanguages } from "~/lib/spoken-languages";
import { formatDate } from "~/lib/utils";
import { OpenToggle } from "./open-toggle";
import { ShareLink } from "./share-link";

/**
 * Everything about one interview, in a dialog.
 *
 * Which interview is open lives in the URL (`?interview=<id>`), not in
 * component state. That is what makes coming back from a candidate's report
 * land on the dialog the admin left rather than a bare list — the browser's
 * own Back does it, with no state to stash and restore. It also means the
 * details are fetched on the server and arrive with the page, so there is no
 * loading flash and no client-side fetching to keep in step.
 *
 * A candidate's report is a full page, not a second view in here: it is long,
 * it has video in it, and it is the thing an admin actually came to read.
 */
export function InterviewDialog({
  details,
  uiLanguage,
  appOrigin,
}: {
  /** Null when no `?interview=` is set — the dialog stays closed. */
  details: InterviewDetails | null;
  uiLanguage: TranslatedLanguageKey;
  /** Resolved on the server so the shared link is the deployed one. */
  appOrigin: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const m = getMessages(uiLanguage);
  const statusLabels: Record<string, string> = m.status;

  /** Dropping the query is what closes it, so Back reopens it. */
  function close() {
    router.push(pathname);
  }

  /**
   * Where the report should return to. Carried explicitly rather than
   * relying on history, so the back link still works on a page opened from
   * a pasted link or a fresh tab.
   */
  const returnTo = details
    ? `${pathname}?interview=${encodeURIComponent(details.id)}`
    : pathname;

  return (
    <Modal
      open={details !== null}
      onClose={close}
      labelledBy="interview-dialog-title"
      title={
        <>
          <span className="min-w-0 break-words">
            {details?.title ?? "Interview"}
          </span>
          {details ? (
            <span
              className={
                details.isOpen
                  ? "rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success"
                  : "rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-content-muted"
              }
            >
              {details.isOpen ? "Open" : "Closed"}
            </span>
          ) : null}
        </>
      }
      description={
        details
          ? `${details.questionCount} skill questions · created ${formatDate(
              details.createdAt,
            )}`
          : undefined
      }
      footer={
        details ? (
          <OpenToggle interviewId={details.id} isOpen={details.isOpen} />
        ) : null
      }
    >
      {details ? (
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-accent/15 bg-accent-soft p-4">
            <h3 className="text-sm font-semibold">Candidate link</h3>
            <p className="text-sm text-content-muted">
              Share this with as many candidates as you like. Each one gets a
              separate attempt and cannot see anyone else&apos;s.
            </p>
            <ShareLink url={`${appOrigin}/i/${details.publicToken}`} />
            {!details.isOpen ? (
              <p className="text-sm text-danger">
                This interview is closed — the link will not accept new
                candidates.
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">
              Candidates ({details.attempts.length})
            </h3>

            {details.attempts.length === 0 ? (
              <EmptyState
                title="No candidates yet"
                description="They appear here as soon as someone opens the link and begins."
              />
            ) : (
              <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                {details.attempts.map((attempt) => (
                  <li
                    key={attempt.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {attempt.candidateName}
                        </span>
                        <StatusBadge
                          status={attempt.status}
                          label={statusLabels[attempt.status] ?? attempt.status}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-content-muted">
                        {attempt.candidateEmail ?? "no email"} ·{" "}
                        {formatSpokenLanguages(
                          attempt.spokenLanguages,
                          attempt.language,
                        )}{" "}
                        · {formatDate(attempt.createdAt)}
                        {attempt.awayCount > 0
                          ? ` · left tab ${attempt.awayCount}×`
                          : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {attempt.overallScore !== null ? (
                        <span className="text-sm font-semibold tabular-nums">
                          {attempt.overallScore}
                          <span className="text-xs text-content-muted">
                            /100
                          </span>
                        </span>
                      ) : null}
                      <Link
                        href={`/admin/attempts/${attempt.id}?from=${encodeURIComponent(
                          returnTo,
                        )}`}
                        className={buttonClasses("secondary", "sm")}
                      >
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
