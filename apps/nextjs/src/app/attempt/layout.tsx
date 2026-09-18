import { CandidateHeader } from "~/components/brand";
import { uiMessages } from "~/server/language";
export default function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const m = uiMessages();
  return (
    // A flex column, so the interview can fill whatever the header leaves
    // without anyone having to know how tall the header is.
    <div className="flex min-h-dvh flex-col">
      <a
        href="#candidate-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3"
      >
        {m.app.skipToContent}
      </a>
      <CandidateHeader />
      <div
        id="candidate-content"
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </div>
  );
}
