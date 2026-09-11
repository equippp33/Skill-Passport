"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, FieldError, Input, Label } from "~/components/ui";
import { PHONE_DIGITS, normalisePhoneInput } from "~/lib/phone";
import { beginAttemptAction } from "~/server/attempt/actions";
import type { CandidateFormState } from "~/server/attempt/actions";

const initialState: CandidateFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
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
  const [phone, setPhone] = useState("");
  const [state, formAction] = useActionState(
    beginAttemptAction.bind(null, token),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Label htmlFor="name">Your full name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          maxLength={120}
          required
          className="min-h-11"
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby="name-error"
        />
        <span id="name-error">
          <FieldError>{state.fieldErrors?.name}</FieldError>
        </span>
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
          className="min-h-11"
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby="email-error"
        />
        <span id="email-error">
          <FieldError>{state.fieldErrors?.email}</FieldError>
        </span>
      </div>

      <div>
        <Label htmlFor="phone">
          Phone{" "}
          <span className="font-normal text-content-muted">(optional)</span>
        </Label>
        {/* Controlled so the field can never hold something the server
            would reject: the eleventh digit is simply not accepted, and a
            pasted "+91 98765 43210" collapses to the ten digits it means.
            `maxLength` alone could not do both — it would have truncated
            the pasted form mid-number. */}
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(event) =>
            setPhone(normalisePhoneInput(event.target.value))
          }
          className="min-h-11"
          placeholder={`${PHONE_DIGITS} digits`}
          aria-invalid={state.fieldErrors?.phone ? true : undefined}
          aria-describedby="phone-hint phone-error"
        />
        <p id="phone-hint" className="mt-1 text-xs text-content-muted">
          {phone.length > 0 && phone.length < PHONE_DIGITS
            ? `${PHONE_DIGITS - phone.length} more to go`
            : "Indian mobile number, without the country code."}
        </p>
        <span id="phone-error">
          <FieldError>{state.fieldErrors?.phone}</FieldError>
        </span>
      </div>

      <SubmitButton />
    </form>
  );
}
