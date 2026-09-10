import { EmptyState } from "~/components/ui";
import { uiMessages } from "~/server/language";

/**
 * Candidate-facing 404.
 *
 * Deliberately offers no navigation: a candidate has no dashboard, and their
 * only legitimate entry point is the link they were sent.
 */
export default function NotFound() {
  const m = uiMessages();

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        headingLevel={1}
        title={m.errors.notFoundTitle}
        description={m.errors.reopenLink}
      />
    </main>
  );
}
