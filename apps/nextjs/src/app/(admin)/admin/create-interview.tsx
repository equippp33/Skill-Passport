"use client";

import { Icon } from "~/components/ui/icon";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert, Button } from "~/components/ui";
import { WORK_SKILLS } from "~/config/work-skills";
import type { WorkSkillId } from "~/config/work-skills";
import { createInterviewAction } from "~/server/admin/actions";

/**
 * Create an interview.
 *
 * The only choice is which skills may get a follow-up: for a ticked skill the
 * interviewer can ask one extra "dig deeper" question when the answer warrants
 * it. Everything else about the interview is fixed.
 */
export function CreateInterview() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<Set<WorkSkillId>>(new Set());

  function toggle(id: WorkSkillId) {
    setFollowUps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createInterviewAction([...followUps]);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/admin/interviews/${result.interviewId}`);
    });
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

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
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">
          Allow follow-up questions on
        </legend>
        <p className="mt-0.5 text-sm text-content-muted">
          For a ticked skill the interviewer may ask one deeper follow-up when
          the answer is substantial. Leave all unticked for none.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {WORK_SKILLS.map((skill) => (
            <label
              key={skill.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={followUps.has(skill.id)}
                onChange={() => toggle(skill.id)}
                className="size-4 shrink-0 cursor-pointer accent-accent"
              />
              <span>{skill.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button
          size="lg"
          disabled={pending}
          aria-busy={pending}
          onClick={create}
        >
          <Icon name="plus" />
          {pending ? "Creating…" : "Create interview"}
        </Button>
        <span className="text-sm text-content-muted">
          {followUps.size === 0
            ? "No follow-ups"
            : `Follow-ups on ${followUps.size} skill${followUps.size === 1 ? "" : "s"}`}
        </span>
      </div>
    </div>
  );
}
