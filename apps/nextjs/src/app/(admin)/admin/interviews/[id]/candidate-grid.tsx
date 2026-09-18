"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input, Select } from "~/components/ui";
import type { AttemptSummary } from "~/server/admin/dto";
import { CandidateCard } from "./candidate-card";

/** Coarse status groups the filter chips work on. */
type Group = "all" | "in_progress" | "completed" | "not_started" | "failed";

function groupOf(status: string): Exclude<Group, "all"> {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "not_started") return "not_started";
  return "in_progress"; // in_progress + processing
}

const FILTERS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "not_started", label: "Not started" },
  { key: "failed", label: "Failed" },
];

type Sort = "recent" | "score_desc" | "score_asc" | "name";

export function CandidateGrid({
  attempts,
  statusLabels,
  returnTo,
}: {
  attempts: AttemptSummary[];
  statusLabels: Record<string, string>;
  /** Where a candidate's report should return to. */
  returnTo: string;
}) {
  const router = useRouter();

  /**
   * Keep a live interview live.
   *
   * These cards are server-rendered, so a candidate who finishes while this
   * page is open stays "In progress" until someone reloads — which is how it
   * looked as though interviews never completed. Re-fetching the server
   * components is cheap and leaves the filter and sort state alone, unlike a
   * full reload.
   *
   * Only while something is actually running: once every attempt has settled
   * there is nothing to watch, and polling an idle page forever is rude to
   * both the database and the laptop.
   */
  const watching = attempts.some(
    (a) => a.status === "in_progress" || a.status === "processing",
  );
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [watching, router]);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [sort, setSort] = useState<Sort>("recent");

  const counts = useMemo(() => {
    const c: Record<Group, number> = {
      all: attempts.length,
      in_progress: 0,
      completed: 0,
      not_started: 0,
      failed: 0,
    };
    for (const a of attempts) c[groupOf(a.status)] += 1;
    return c;
  }, [attempts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = attempts.filter((a) => {
      if (group !== "all" && groupOf(a.status) !== group) return false;
      if (!q) return true;
      return (
        a.candidateName.toLowerCase().includes(q) ||
        (a.candidateEmail?.toLowerCase().includes(q) ?? false) ||
        (a.candidatePhone?.toLowerCase().includes(q) ?? false)
      );
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.candidateName.localeCompare(b.candidateName);
        case "score_desc":
          return (b.overallScore ?? -1) - (a.overallScore ?? -1);
        case "score_asc":
          return (a.overallScore ?? 101) - (b.overallScore ?? 101);
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });
    return list;
  }, [attempts, query, group, sort]);

  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface p-10 text-center">
        <p className="text-sm font-medium">No candidates yet</p>
        <p className="mt-1 text-sm text-content-muted">
          They appear here as soon as someone opens the link and begins.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">
          Candidates{" "}
          <span className="font-normal text-content-muted">
            ({shown.length}
            {shown.length !== attempts.length ? ` of ${attempts.length}` : ""})
          </span>
        </h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or phone"
            aria-label="Search candidates"
            className="h-10 w-64 max-w-full"
          />
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort candidates"
            className="h-10 w-auto"
          >
            <option value="recent">Most recent</option>
            <option value="score_desc">Highest score</option>
            <option value="score_asc">Lowest score</option>
            <option value="name">Name (A–Z)</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setGroup(f.key)}
            className={
              group === f.key
                ? "rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast"
                : "rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted"
            }
          >
            {f.label}
            <span
              className={
                group === f.key
                  ? "ml-1.5 text-accent-contrast/70"
                  : "ml-1.5 text-content-muted/70"
              }
            >
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border-subtle bg-surface p-8 text-center text-sm text-content-muted">
          No candidates match.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {shown.map((attempt) => (
            <CandidateCard
              key={attempt.id}
              attempt={attempt}
              statusLabel={statusLabels[attempt.status] ?? attempt.status}
              returnTo={returnTo}
            />
          ))}
        </div>
      )}
    </section>
  );
}
