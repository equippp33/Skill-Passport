import type { AttemptTab, SkillComparisonRow } from "~/server/admin/service";

/** Same colour bands as the report: green good, amber middling, red weak. */
function tone(score: number | null): string {
  if (score === null) return "text-content-muted";
  if (score >= 7) return "text-success";
  if (score >= 4) return "text-warning";
  return "text-danger";
}

/**
 * Side-by-side scores across a candidate's attempts — every skill in rows, each
 * attempt in a column (oldest first), so a reviewer can see at a glance whether
 * the assessment was consistent and where the candidate moved between rounds.
 * Screen-only: the printed report is per-attempt.
 */
export function AttemptComparison({
  attempts,
  skills,
}: {
  attempts: AttemptTab[];
  skills: SkillComparisonRow[];
}) {
  return (
    <section
      data-print-hide
      className="rounded-xl border border-border-subtle bg-surface p-4"
    >
      <h2 className="text-sm font-semibold">Score comparison across attempts</h2>
      <p className="mt-0.5 text-xs text-content-muted">
        Every skill, each attempt side by side — oldest first. Scores are out of
        10.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="py-2 pr-3 text-left font-medium text-content-muted">
                Skill
              </th>
              {attempts.map((a) => (
                <th
                  key={a.attemptId}
                  className={`px-3 py-2 text-center font-semibold ${
                    a.isCurrent ? "text-accent" : ""
                  }`}
                >
                  Attempt {a.attemptNumber}
                  {a.isCurrent ? (
                    <span className="ml-1 text-[10px] font-normal">(this)</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border-subtle">
              <td className="py-2 pr-3 font-semibold">Overall</td>
              {attempts.map((a) => {
                const overall =
                  a.status === "completed" && a.overallScore !== null
                    ? a.overallScore / 10
                    : null;
                return (
                  <td
                    key={a.attemptId}
                    className={`px-3 py-2 text-center font-semibold tabular-nums ${tone(
                      overall,
                    )}`}
                  >
                    {overall === null ? "—" : overall.toFixed(1)}
                  </td>
                );
              })}
            </tr>
            {skills.map((row) => (
              <tr
                key={row.skillId}
                className="border-b border-border-subtle/60 last:border-0"
              >
                <td className="py-2 pr-3">{row.label}</td>
                {row.scores.map((s, i) => (
                  <td
                    key={`${row.skillId}-${i}`}
                    className={`px-3 py-2 text-center tabular-nums ${tone(s)}`}
                  >
                    {s === null ? "—" : s}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
