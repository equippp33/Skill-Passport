"use client";
import { BrandMark } from "~/components/brand";
import { Button } from "~/components/ui";

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[65dvh] max-w-lg items-center px-4 py-12">
      <div
        role="alert"
        className="w-full rounded-2xl border border-border-subtle bg-surface p-8 text-center shadow-[var(--shadow-card)]"
      >
        <BrandMark className="mx-auto mb-5 size-12" />
        <h1 className="text-2xl font-semibold tracking-tight">
          We could not load this page
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-content-muted">
          Please try again. If you were taking an interview, keep this tab open
          and use the same interview link to return.
        </p>
        <Button className="mt-6" onClick={() => retry()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
