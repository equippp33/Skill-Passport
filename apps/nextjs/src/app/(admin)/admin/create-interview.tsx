"use client";

import { Icon } from "~/components/ui/icon";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button } from "~/components/ui";
import { createInterviewAction } from "~/server/admin/actions";

/**
 * Create an interview.
 *
 * There is nothing to configure. Every interview covers the same workplace
 * skills, picks up the candidate's language from how they answer, and decides
 * a follow-up from each answer on its own — so this is just a button.
 */
export function CreateInterview() {
  const router = useRouter();
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
      router.push(`/admin/interviews/${result.interviewId}`);
    });
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex items-start gap-3">
        <span className="hidden size-10 shrink-0 place-items-center rounded-xl border border-accent/15 bg-surface text-accent sm:grid">
          <Icon name="mic" className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Your next interview starts here
          </h2>
          <p className="mt-0.5 max-w-lg text-sm leading-snug text-content-muted">
            Create a link, invite candidates, and get a structured view of their
            workplace skills.
          </p>
        </div>
      </div>

      <div>
        <Button
          size="lg"
          disabled={pending}
          aria-busy={pending}
          onClick={create}
        >
          <Icon name="plus" />
          {pending ? "Creating…" : "Create interview"}
        </Button>
      </div>
    </div>
  );
}
