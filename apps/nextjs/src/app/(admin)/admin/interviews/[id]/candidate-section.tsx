"use client";

import { useState } from "react";
import Link from "next/link";

import type { RepeatCandidate } from "~/server/admin/dto";

/** Green good, amber middling, red weak — matching the report. */
function tone(score: number | null): string {
  if (score === null) return "text-content-muted";
  if (score >= 7) return "text-success";
  if (score >= 4) return "text-warning";
  return "text-danger";
}

/**
 * Wraps the candidate grid with a tab switch to a "Retake comparison" table —
 * every candidate who took the interview more than once, their attempt scores
 * side by side, so a reviewer can scan how consistent the repeats were. The tab
 * only appears when there are repeat candidates.
 */
export function CandidateSection({
  comparison,
  returnTo,
  children,
}: {
  comparison: RepeatCandidate[];
  returnTo: string;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState<"candidates" | "comparison">("candidates");
  const hasComparison = comparison.length > 0;
  const maxAttempts = hasComparison
    ? Math.max(...comparison.map((c) => c.attempts.length))
    : 0;

  if (!hasComparison) return <>{children}</>;

  const tabClass = (active: boolean) =>
    active
      ? "border-b-2 border-accent px-1 pb-2 text-sm font-semibold text-accent"
      : "border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-content-muted hover:text-content";

  return (
    <div className="space-y-4">
      <div className="flex gap-5 border-b border-border-subtle">
        <button
          type="button"
          onClick={() => setTab("candidates")}
          className={tabClass(tab === "candidates")}
        >
          Candidates
        </button>
        <button
          type="button"
          onClick={() => setTab("comparison")}
          className={tabClass(tab === "comparison")}
        >
          Retake comparison
          <span className="ml-1.5 font-normal text-content-muted/70">
            {comparison.length}
          </span>
        </button>
      </div>

      {tab === "candidates" ? (
        children
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-subtle">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted/40 text-left">
                <th className="px-3 py-2 font-medium text-content-muted">
                  Candidate
                </th>
                {Array.from({ length: maxAttempts }, (_, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-center font-medium text-content-muted"
                  >
                    Attempt {i + 1}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium text-content-muted">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((c) => {
                const scores = c.attempts.map((a) => a.overallScore);
                const first = scores.find((s) => s !== null) ?? null;
                const last =
                  [...scores].reverse().find((s) => s !== null) ?? null;
                const delta =
                  first !== null && last !== null && scores.length > 1
                    ? last - first
                    : null;
                return (
                  <tr
                    key={c.reportAttemptId}
                    className="border-b border-border-subtle/60 last:border-0"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/attempts/${c.reportAttemptId}?from=${encodeURIComponent(
                          returnTo,
                        )}`}
                        className="font-medium text-accent underline-offset-2 hover:underline"
                      >
                        {c.candidateName}
                      </Link>
                      {c.candidateEmail ? (
                        <div className="text-xs text-content-muted">
                          {c.candidateEmail}
                        </div>
                      ) : null}
                    </td>
                    {Array.from({ length: maxAttempts }, (_, i) => {
                      const a = c.attempts[i];
                      const score = a?.overallScore ?? null;
                      return (
                        <td
                          key={i}
                          className={`px-3 py-2 text-center font-semibold tabular-nums ${tone(
                            score,
                          )}`}
                        >
                          {!a
                            ? ""
                            : a.status === "completed" && score !== null
                              ? score.toFixed(1)
                              : "—"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center text-xs font-medium tabular-nums">
                      {delta === null ? (
                        <span className="text-content-muted">—</span>
                      ) : delta > 0 ? (
                        <span className="text-success">▲ {delta.toFixed(1)}</span>
                      ) : delta < 0 ? (
                        <span className="text-danger">
                          ▼ {Math.abs(delta).toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-content-muted">0.0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
