import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "~/components/ui/icon";
import { requireAdmin } from "~/server/admin/service";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireAdmin("/admin/reset-password");

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-content-muted underline-offset-4 hover:underline"
        >
          <Icon name="arrow" className="size-4 rotate-180" />
          Back
        </Link>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">
          Reset password
        </h1>
        <p className="text-xs text-content-muted">
          Change the password for this admin account.
        </p>
      </div>

      <ResetPasswordForm />
    </div>
  );
}
