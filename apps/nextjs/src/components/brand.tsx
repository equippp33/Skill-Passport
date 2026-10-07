import { cn } from "~/lib/utils";

/**
 * The Path Saathi wordmark.
 *
 * One horizontal logo (public/assets/logo-horizontal.webp), always sized by
 * HEIGHT so it can never distort — callers set the height (`h-8`, `h-10`) and
 * the width follows. A plain <img> on purpose: it is a small static asset that
 * needs no runtime optimisation, and next/image would force an intrinsic
 * width/height we would have to keep in sync with the file.
 */
export function Brand({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset
    <img
      src="/assets/logo-horizontal.webp"
      alt="Path Saathi"
      className={cn("h-9 w-auto shrink-0 select-none sm:h-10", className)}
    />
  );
}

/**
 * Kept for the couple of spots that used the old compact mark — it is the same
 * logo now, so they just pass a height.
 */
export const BrandMark = Brand;

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
