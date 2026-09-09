"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  Alert,
  Button,
  FieldError,
  Input,
  Label,
  Textarea,
} from "~/components/ui";
import { createInterviewAction } from "~/server/admin/actions";
import type { AdminFormState } from "~/server/admin/actions";

const initialState: AdminFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" disabled={pending}>
      {pending ? "Creating…" : "Create interview"}
    </Button>
  );
}

export function CreateInterviewForm() {
  const [state, formAction] = useActionState(
    createInterviewAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Label htmlFor="title">Interview name</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. Store Assistant — March intake"
          maxLength={120}
          required
          aria-invalid={state.fieldErrors?.title ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.title}</FieldError>
      </div>

      <div>
        <Label htmlFor="description">
          Note for candidates{" "}
          <span className="font-normal text-content-muted">(optional)</span>
        </Label>
        <Textarea
          id="description"
          name="description"
          maxLength={500}
          placeholder="Shown on the page candidates see before they begin."
          aria-invalid={state.fieldErrors?.description ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.description}</FieldError>
      </div>

      <SubmitButton />
    </form>
  );
}
