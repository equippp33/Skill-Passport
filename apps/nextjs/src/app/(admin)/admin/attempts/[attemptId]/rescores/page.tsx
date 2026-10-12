import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getScoreHistory, requireAdmin } from "~/server/admin/service";
import { uuidSchema } from "~/server/interview/validation";
import { VersionCompare } from "./version-compare";

export const metadata: Metadata = { title: "Score history" };
export const dynamic = "force-dynamic";

/**
 * Every version of one report, side by side. DEVELOPMENT ONLY.
 *
 * Its own page rather than a dialog, for two reasons. A comparison of eleven
 * skills across several versions needs the width, and a page can be printed:
 * the PDF export is this exact page through headless Chromium, so the file
 * and the screen cannot drift apart.
 *
 * `getScoreHistory` returns null outside development and for an attempt
 * belonging to another admin, so both checks collapse into one `notFound()`.
 */
export default async function RescoreHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const admin = await requireAdmin("/admin");
  const { attemptId: raw } = await params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const history = await getScoreHistory(admin.id, parsed.data);
  if (!history) notFound();

  /**
   * Which versions to show, from `?v=1,3`.
   *
   * Exists so the PDF render honours the choice made on screen: the export
   * drives a browser at this same URL, and the selection is client state it
   * would otherwise know nothing about. Ignored when it names no version this
   * attempt actually has.
   */
  const { v } = await searchParams;
  const known = new Set(history.versions.map((x) => x.version));
  const initialSelected = (v ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && known.has(n));

  return (
    <div className="space-y-6">
      <div data-print-hide>
        <Link
          href={`/admin/attempts/${history.attemptId}`}
          className="inline-flex items-center gap-1.5 text-sm text-content-muted underline-offset-4 hover:underline"
        >
          Back to report
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {history.candidateName}
        </h1>
        <p className="mt-1 text-sm text-content-muted">
          {history.interviewTitle}
          {" · "}
          {history.rescoreCount === 0
            ? "never re-scored"
            : `re-scored ${history.rescoreCount} ${
                history.rescoreCount === 1 ? "time" : "times"
              } · ${history.versions.length} versions`}
        </p>
      </div>

      {history.versions.length === 1 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-content-muted">
          This report has never been re-scored, so there is nothing to compare.
          The single version below is the original scoring.
        </div>
      ) : null}

      <VersionCompare
        attemptId={history.attemptId}
        versions={history.versions}
        initialSelected={initialSelected}
      />
    </div>
  );
}
