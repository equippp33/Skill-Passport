"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, FieldError, Input, Label } from "~/components/ui";
import type { Messages } from "~/config/messages";
import { EMAIL_TAKEN } from "~/lib/auth-errors";
import { signupAction } from "~/server/auth/actions";
import type { AuthFormState } from "~/server/auth/actions";

const initialState: AuthFormState = { error: null };

function SubmitButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? busy : label}
    </Button>
  );
}

export function SignupForm({ m }: { m: Messages }) {
  const [state, formAction] = useActionState(signupAction, initialState);

  // The action returns a sentinel so the message can be localized here.
  const emailError =
    state.fieldErrors?.email === EMAIL_TAKEN
      ? m.signup.emailTaken
      : state.fieldErrors?.email;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Label htmlFor="email">{m.login.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={emailError ? true : undefined}
          aria-describedby="email-error"
        />
        <span id="email-error">
          <FieldError>{emailError}</FieldError>
        </span>
      </div>

      <div>
        <Label htmlFor="password">{m.login.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          // `new-password` tells password managers to offer a generated one.
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby="password-hint password-error"
        />
        <p id="password-hint" className="mt-1.5 text-sm text-content-muted">
          {m.signup.passwordHint}
        </p>
        <span id="password-error">
          <FieldError>{state.fieldErrors?.password}</FieldError>
        </span>
      </div>

      <SubmitButton label={m.signup.submit} busy={m.signup.submitting} />
    </form>
  );
}
