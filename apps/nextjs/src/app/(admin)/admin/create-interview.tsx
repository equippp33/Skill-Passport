"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Alert, Button } from "~/components/ui";
import { createInterviewAction } from "~/server/admin/actions";

/**
 * Create an interview in one click.
 *
 * There is no form because there is nothing to ask: every interview covers
 * the same ten workplace skills and adopts whatever language the candidate
 * answers in. A name field would only have been something to think about
 * before getting a link.
 *
 * On success this navigates to the new interview's dialog, since the link is
 * the whole reason for pressing the button.
 */
export function CreateInterview() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createInterviewAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(
        `${pathname}?interview=${encodeURIComponent(result.interviewId)}`,
      );
    });
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="md" disabled={pending} onClick={create}>
          {pending ? "Creating…" : "Create interview"}
        </Button>
        <p className="text-sm text-content-muted">
          Makes a general interview link you can send to any number of
          candidates.
        </p>
      </div>
    </div>
  );
}
