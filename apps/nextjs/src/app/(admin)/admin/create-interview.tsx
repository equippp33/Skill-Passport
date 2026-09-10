"use client";

import { Icon } from "~/components/ui/icon";
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

      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="hidden size-12 shrink-0 place-items-center rounded-2xl border border-accent/15 bg-surface text-accent sm:grid">
            <Icon name="mic" className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Your next interview starts here
            </h2>
            <p className="mt-1 max-w-lg text-sm leading-relaxed text-content-muted">
              Create a link, invite candidates, and get a structured view of ten
              workplace skills.
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-accent">
              <span>01 / Create</span>
              <span>02 / Share</span>
              <span>03 / Review</span>
            </p>
          </div>
        </div>
        <Button
          size="lg"
          className="shrink-0"
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
