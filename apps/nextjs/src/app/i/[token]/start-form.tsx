"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, FieldError, Input, Label } from "~/components/ui";
import { beginAttemptAction } from "~/server/attempt/actions";
import type { CandidateFormState } from "~/server/attempt/actions";

const initialState: CandidateFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Starting…" : "Continue"}
    </Button>
  );
}

/**
 * Candidate details, collected before an attempt exists.
 *
 * The public token is bound into the action here rather than posted as a
 * form field, so the browser cannot point this submission at a different
 * interview.
 */
export function StartForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    beginAttemptAction.bind(null, token),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Label htmlFor="name">Your full name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          maxLength={120}
          required
          aria-invalid={state.fieldErrors?.name ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.name}</FieldError>
      </div>

      <div>
        <Label htmlFor="email">
          Email{" "}
          <span className="font-normal text-content-muted">(optional)</span>
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={255}
          aria-invalid={state.fieldErrors?.email ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.email}</FieldError>
      </div>

      <div>
        <Label htmlFor="phone">
          Phone{" "}
          <span className="font-normal text-content-muted">(optional)</span>
        </Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={32}
          aria-invalid={state.fieldErrors?.phone ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.phone}</FieldError>
      </div>

      <SubmitButton />
    </form>
  );
}
