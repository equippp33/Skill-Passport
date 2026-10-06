"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button } from "~/components/ui";
import { rescoreAttemptAction } from "~/server/admin/actions";

/**
 * Re-grade this report from its stored transcripts — useful after a scoring
 * change. Re-runs only the grading (no re-recording or speech APIs), then
 * refreshes so the new per-skill scores, overall score and summary show.
 *
 * It can take a little while (one model call per answered question), so the
 * button owns its own pending state.
 */
export function RescoreReport({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function rescore() {
    setError(null);
    startTransition(async () => {
      const result = await rescoreAttemptAction(attemptId);
      if (!result.ok) {
        setError(result.error ?? "The report could not be re-scored.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <Alert tone="danger" className="py-1.5 text-xs">
          {error}
        </Alert>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={rescore}
      >
        {pending ? "Re-scoring…" : "Re-score"}
      </Button>
    </div>
  );
}
