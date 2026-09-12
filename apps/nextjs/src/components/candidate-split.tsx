import type { ReactNode } from "react";

import { InterviewSteps } from "~/components/interview-steps";

/**
 * The shared two-panel shell for the candidate onboarding steps.
 *
 * One whole side is the camera; the other is every detail for that step. The
 * two sides are locked to the viewport height on desktop: the details side
 * scrolls on its own when it overflows, while the camera side stays put and
 * fills its half completely. On narrow screens the panels simply stack.
 *
 * Keeping this in one component is what makes "Your details" and "Device
 * check" read as the same screen with different contents, rather than two
 * pages that happen to share a header.
 */
export function CandidateSplit({
  step,
  camera,
  children,
  align = "start",
}: {
  step: 1 | 2 | 3;
  /** Fills the whole camera side — pass a `CameraPreview`. */
  camera: ReactNode;
  /** Everything else for this step. Scrolls independently when tall. */
  children: ReactNode;
  /**
   * How the details sit in their half. `center` for a short step (the form)
   * so it uses the whole side instead of hugging the top; `start` for a tall
   * step (the device check) that fills top-down and scrolls when it overflows.
   */
  align?: "start" | "center";
}) {
  return (
    <div className="grid lg:h-[calc(100dvh-73px)] lg:grid-cols-2">
      <section
        className={`flex flex-col gap-4 px-4 py-4 sm:px-8 lg:min-h-0 ${
          // The tall step scrolls its own panel; the short centered one never
          // needs to, so it skips the scrollbar entirely.
          align === "start" ? "lg:overflow-y-auto" : ""
        }`}
      >
        {/* Stepper stays pinned to the top; the rest of the step fills the
            space below it. */}
        <InterviewSteps current={step} />
        <div
          className={`flex flex-1 flex-col gap-4 ${
            align === "center" ? "lg:justify-center" : ""
          }`}
        >
          {children}
        </div>
      </section>

      <aside className="p-3 pt-0 sm:p-4 lg:h-full lg:pt-4">{camera}</aside>
    </div>
  );
}
