import { notFound } from "next/navigation";

import { env } from "~/env";
import { Icon } from "~/components/ui/icon";
import { Brand } from "~/components/brand";
import { ReturnToDashboard } from "~/app/attempt/[attemptId]/result/return-to-dashboard";

export const dynamic = "force-dynamic";

/** Dev-only preview of the candidate "Interview submitted" page (it is normally
 *  behind the attempt cookie, so there's no way to view it otherwise). Renders
 *  the real card + button; 404s in production. Safe to delete anytime. */
const DASHBOARD_URL = "https://pathsaathi.com/dashboard";

export default function DevSubmittedPreview() {
  if (env.NODE_ENV === "production") notFound();

  return (
    <>
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface px-4 py-4 sm:px-8">
        <Brand />
        <span className="text-sm font-medium">Alhad Syed</span>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-8">
        <div className="mt-6 rounded-2xl border border-success/20 bg-success-soft p-8 text-center">
          <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-surface text-success">
            <Icon name="check" className="size-7" />
          </span>

          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Interview submitted
          </h1>

          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-content-muted text-pretty">
            Thanks for your time, Alhad. Your answers for General interview 56
            have been received and are with the team now.
          </p>

          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-content-muted text-pretty">
            Someone will review them and get back to you.
          </p>

          <ReturnToDashboard url={DASHBOARD_URL} />
        </div>
      </main>
    </>
  );
}
