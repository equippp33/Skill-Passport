"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button } from "~/components/ui";
import { resendResultAction } from "~/server/admin/actions";

/**
 * Re-send this candidate's result to the partner webhook. Shown only for
 * integration candidates; useful when the result never reached the partner
 * (webhook configured after the interview, or a delivery failed). Rebuilds the
 * stored payload and re-POSTs — no re-scoring or speech APIs.
 */
export function ResendResult({
  attemptId,
  delivered,
}: {
  attemptId: string;
  delivered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resend() {
    setError(null);
    startTransition(async () => {
      const result = await resendResultAction(attemptId);
      if (!result.ok) {
        setError(result.error ?? "The result could not be sent.");
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
        onClick={resend}
      >
        {pending
          ? "Sending…"
          : delivered
            ? "Resend to partner"
            : "Send to partner"}
      </Button>
    </div>
  );
}
