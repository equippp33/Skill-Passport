"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui";
import { setInterviewOpenAction } from "~/server/admin/actions";

/**
 * Close or reopen an interview.
 *
 * Closing only stops the link accepting NEW candidates — attempts already
 * under way finish normally and nothing is deleted. That is worth saying out
 * loud, because "close" reads as destructive, so closing asks to confirm
 * while reopening (which takes nothing away) does not.
 */
export function OpenToggle({
  interviewId,
  isOpen,
}: {
  interviewId: string;
  isOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function apply(next: boolean) {
    setConfirming(false);
    startTransition(async () => {
      await setInterviewOpenAction(interviewId, next);
      // The dialog is server-rendered from the URL, so a refresh re-reads
      // the interview and the badge follows.
      router.refresh();
    });
  }

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => apply(true)}
      >
        {pending ? "Reopening…" : "Reopen interview"}
      </Button>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-content-muted">
          Stop accepting new candidates?
        </span>
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() => apply(false)}
        >
          {pending ? "Closing…" : "Yes, close"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => setConfirming(true)}
    >
      Close interview
    </Button>
  );
}
