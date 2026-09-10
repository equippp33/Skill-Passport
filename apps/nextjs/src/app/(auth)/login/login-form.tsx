"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction } from "~/server/auth/actions";
import type { AuthFormState } from "~/server/auth/actions";
import { Alert, Button, FieldError, Input, Label } from "~/components/ui";
import type { Messages } from "~/config/messages";

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

export function LoginForm({ next, m }: { next?: string; m: Messages }) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <div>
        <Label htmlFor="email">{m.login.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={
            state.fieldErrors?.email ? "email-error" : undefined
          }
        />
        <span id="email-error">
          <FieldError>{state.fieldErrors?.email}</FieldError>
        </span>
      </div>

      <div>
        <Label htmlFor="password">{m.login.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors?.password ? true : undefined}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
        />
        <span id="password-error">
          <FieldError>{state.fieldErrors?.password}</FieldError>
        </span>
      </div>

      <SubmitButton label={m.login.submit} busy={m.login.submitting} />
    </form>
  );
}
