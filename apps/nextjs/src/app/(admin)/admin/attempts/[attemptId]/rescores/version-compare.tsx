"use client";

import { useMemo, useState } from "react";

import { Button } from "~/components/ui";
import type { ScoreVersion } from "~/server/admin/service";
import { formatDateTime } from "~/lib/utils";
import { DownloadComparison } from "./download-comparison";

/**
 * The comparison itself, with the choice of which versions to show.
 *
 * Client-side because the choice is interactive, and because a candidate
 * re-scored half a dozen times produces a table too wide to read — the point
 * of picking versions is usually "the original against now", with the middle
 * left out.
 *
 * The selection is reflected into the PDF through the download URL rather
 * than being re-made there, so the file is whatever is on screen.
 */
export function VersionCompare({
  attemptId,
  versions,
  initialSelected,
}: {
  attemptId: string;
  versions: ScoreVersion[];
  /** Versions to show on load, from `?v=` so a PDF render honours the choice. */
  initialSelected: number[];
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () =>
      new Set(
        initialSelected.length > 0
          ? initialSelected
          : versions.map((v) => v.version),
      ),
  );
  const [picking, setPicking] = useState(false);

  const shown = useMemo(
    () => versions.filter((v) => selected.has(v.version)),
    [versions, selected],
  );

  const first = shown[0];
  const latest = shown[shown.length - 1];
  const delta =
    first && latest && first.overallScore !== null && latest.overallScore !== null
      ? latest.overallScore - first.overallScore
      : null;

  /** Never leave nothing on screen. */
  function toggle(version: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        if (next.size === 1) return prev;
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  }

  return (
    <>
      <div
        data-print-hide
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {versions.length > 2 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPicking(true)}
          >
            Choose versions ({shown.length} of {versions.length})
          </Button>
        ) : null}
        <DownloadComparison
          attemptId={attemptId}
          versions={[...selected].sort((a, b) => a - b)}
        />
      </div>

      {picking ? (
        <div
          data-print-hide
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPicking(false)}
        >
          <div
            role="dialog"
            aria-label="Choose versions to compare"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-border-subtle bg-surface p-4 shadow-lg"
          >
            <p className="text-sm font-semibold">Which versions to compare</p>
            <p className="mt-1 text-xs text-content-muted">
              At least one stays selected.
            </p>

            <ul className="mt-3 space-y-1">
              {versions.map((v) => (
                <li key={v.version}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={selected.has(v.version)}
                      onChange={() => toggle(v.version)}
                      className="size-4 accent-[var(--color-accent,currentColor)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {v.label}
                        {v.isCurrent ? (
                          <span className="ml-1.5 text-xs font-normal text-accent">
                            shown now
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-content-muted">
                        {formatDateTime(v.scoredAt)}
                        {v.overallScore !== null
                          ? ` · ${(v.overallScore / 10).toFixed(1)}/10`
                          : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelected(new Set(versions.map((v) => v.version)))
                }
                className="text-xs text-content-muted underline-offset-4 hover:underline"
              >
                Select all
              </button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    // First and last only — the usual question.
                    const ends = [
                      versions[0]!.version,
                      versions[versions.length - 1]!.version,
                    ];
                    setSelected(new Set(ends));
                  }}
                >
                  First &amp; last
                </Button>
                <Button size="sm" onClick={() => setPicking(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border-subtle">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-muted">
              <th className="px-4 py-2.5 text-left font-medium">Skill</th>
              {shown.map((v) => (
                <th
                  key={v.version}
                  className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${
                    v.isCurrent ? "text-accent" : "text-content-muted"
                  }`}
                >
                  {v.label}
                  {v.isCurrent ? " (shown now)" : ""}
                  <span className="block text-xs font-normal text-content-muted">
                    {formatDateTime(v.scoredAt)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-border-strong bg-surface-muted/60">
              <td className="px-4 py-2.5 font-semibold">Overall</td>
              {shown.map((v) => (
                <td
                  key={v.version}
                  className="px-4 py-2.5 text-right text-base font-semibold tabular-nums"
                >
                  {v.overallScore === null
                    ? "—"
                    : (v.overallScore / 10).toFixed(1)}
                </td>
              ))}
            </tr>
            {(latest?.skills ?? []).map((skill, i) => (
              <tr key={skill.skillId} className="border-b border-border-subtle">
                <td className="px-4 py-2 font-medium">{skill.label}</td>
                {shown.map((v, vi) => {
                  const score = v.skills[i]?.score ?? null;
                  // Against the previous SHOWN column, so hiding the middle
                  // versions still reads as a straight before-and-after.
                  const prev =
                    vi > 0 ? (shown[vi - 1]?.skills[i]?.score ?? null) : null;
                  const moved =
                    score !== null && prev !== null ? score - prev : null;
                  return (
                    <td
                      key={v.version}
                      className="px-4 py-2 text-right tabular-nums"
                    >
                      {score === null ? (
                        <span className="text-content-muted">—</span>
                      ) : (
                        <>
                          {score}
                          {moved ? (
                            <span
                              className={`ml-1.5 text-xs ${
                                moved > 0 ? "text-success" : "text-danger"
                              }`}
                            >
                              {moved > 0 ? `+${moved}` : moved}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {delta !== null && shown.length > 1 && first ? (
        <p className="text-sm text-content-muted">
          Overall moved{" "}
          <span
            className={
              delta > 0
                ? "font-semibold text-success"
                : delta < 0
                  ? "font-semibold text-danger"
                  : "font-semibold"
            }
          >
            {delta > 0 ? "+" : ""}
            {(delta / 10).toFixed(1)}
          </span>{" "}
          from {first.label.toLowerCase()} to {latest!.label.toLowerCase()}.
        </p>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Written report, by version
        </h2>
        {shown.map((v) => (
          <div
            key={v.version}
            className="rounded-xl border border-border-subtle p-4"
          >
            <p className="text-sm font-semibold">
              {v.label}
              {v.isCurrent ? (
                <span className="ml-2 text-xs font-normal text-accent">
                  shown on the report now
                </span>
              ) : null}
              <span className="ml-2 text-xs font-normal text-content-muted">
                {formatDateTime(v.scoredAt)}
              </span>
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              {v.summary ?? <span className="text-content-muted">—</span>}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <List title="Strengths" items={v.strengths} marker="✓" />
              <List title="Improvements" items={v.improvements} marker="→" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function List({
  title,
  items,
  marker,
}: {
  title: string;
  items: string[];
  marker: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-content-muted">{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-content-muted">—</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span aria-hidden className="text-content-muted">
                {marker}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
