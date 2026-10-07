import type { AttemptCosts } from "~/server/admin/service";

/**
 * What this candidate cost to interview — development only.
 *
 * The grid's card badge is the candidate's whole bill across every retake,
 * which is the right figure there and the wrong one here: this page is about
 * one attempt. So this names both — what the open attempt cost, and, when
 * there are retakes, each of them and the sum that the card shows.
 *
 * A "~" means Sarvam's share is reconstructed from how many questions the
 * interview got through, rather than measured — nothing recorded its tokens
 * before 6 October 2026, and tokens leave no trace once the reply is parsed.
 * The reconstruction is close in aggregate and loose on any single run, so
 * read a "~" figure here as an order of magnitude. It is still far better than
 * the ₹0.00 it replaces, which read as "Sarvam was free" rather than "nobody
 * counted".
 */
export function AttemptCost({ costs }: { costs: AttemptCosts }) {
  const retakes = costs.attempts.length > 1;

  return (
    <div
      data-print-hide
      className="mt-4 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-xs"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold tracking-wide text-content-muted uppercase">
          Cost · dev only
        </span>
        <span className="tabular-nums text-content-muted">{costs.parts}</span>
        <span className="font-semibold tabular-nums">
          This attempt {costs.currentEstimated ? "≥" : ""}
          {costs.current ?? "₹—"}
        </span>
      </div>

      {retakes ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-subtle pt-1.5 text-content-muted">
          {costs.attempts.map((a) => (
            <span
              key={a.attemptId}
              className={`tabular-nums ${
                a.isCurrent ? "font-semibold text-content" : ""
              }`}
            >
              Attempt {a.attemptNumber} {a.estimated ? "≥" : ""}
              {a.cost ?? "₹—"}
            </span>
          ))}
          <span className="font-semibold tabular-nums text-content">
            All {costs.attempts.length} attempts {costs.totalEstimated ? "≥" : ""}
            {costs.total ?? "₹—"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
