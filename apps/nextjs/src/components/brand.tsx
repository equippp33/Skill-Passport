import { cn } from "~/lib/utils";

/** An original passport spine, voice waveform and verification stamp. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      fill="none"
      className={cn("size-10 shrink-0", className)}
    >
      <rect width="48" height="48" rx="13" fill="#4338CA" />
      <path
        d="M16 11h17a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H16a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z"
        stroke="white"
        strokeWidth="2"
      />
      <path
        d="M18 11v26M23 21v6M27 17v14M31 21v6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="36"
        cy="35"
        r="8"
        fill="#C7D2FE"
        stroke="#4338CA"
        strokeWidth="2"
      />
      <path
        d="m32.5 35 2.3 2.3 4.5-4.6"
        stroke="#312E81"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span
      lang="en"
      className={cn("inline-flex items-center gap-3 text-content", className)}
    >
      <BrandMark />
      <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
        Skill <span className="text-accent">Passport</span>
      </span>
    </span>
  );
}

export function CandidateHeader() {
  return (
    <header className="border-b border-border-subtle bg-surface px-4 py-4 sm:px-8">
      <div className="flex w-full items-center justify-between gap-3">
        <Brand />
        {/* Filled by <HeaderProfile> once the candidate is known (from the
            device-check step on); empty on the first page. */}
        <div id="candidate-header-slot" className="flex items-center" />
      </div>
    </header>
  );
}
