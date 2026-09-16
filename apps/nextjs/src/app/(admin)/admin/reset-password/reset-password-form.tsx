"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, FieldError, Input, Label } from "~/components/ui";
import { changePasswordAction } from "~/server/auth/actions";
import type { AuthFormState } from "~/server/auth/actions";

const initial: AuthFormState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="md" disabled={pending} aria-busy={pending}>
      {pending ? "Updating…" : "Update password"}
    </Button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initial);

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? (
        <Alert tone="success">Your password has been updated.</Alert>
      ) : null}

      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors?.currentPassword ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.currentPassword}</FieldError>
      </div>

      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={state.fieldErrors?.newPassword ? true : undefined}
        />
        <p className="mt-1 text-xs text-content-muted">At least 8 characters.</p>
        <FieldError>{state.fieldErrors?.newPassword}</FieldError>
      </div>

      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={state.fieldErrors?.confirmPassword ? true : undefined}
        />
        <FieldError>{state.fieldErrors?.confirmPassword}</FieldError>
      </div>

      <Submit />
    </form>
  );
}
