import { Icon } from "~/components/ui/icon";
import { cn } from "~/lib/utils";

/**
 * The three-stage progress rail shown across the candidate flow:
 * Your details → Device check → Interview.
 *
 * Presentational and server-safe. Labels are kept in English here — the same
 * copy the flow has always used — so both the public landing page (a server
 * component with no message dictionary) and the device-check screen can share
 * one source of truth instead of each hand-rolling the markup.
 */

const STEPS = ["Your details", "Device check", "Interview"] as const;

export function InterviewSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="Interview steps"
      className="grid grid-cols-3 gap-2 sm:gap-3"
    >
      {STEPS.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const state =
          step < current ? "done" : step === current ? "current" : "todo";

        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
              state === "current" &&
                "border-accent/25 bg-accent-soft text-accent",
              state === "done" &&
                "border-border-subtle bg-surface text-content-muted",
              state === "todo" &&
                "border-border-subtle bg-surface-muted text-content-muted",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                state === "current" && "bg-accent text-accent-contrast",
                state === "done" && "bg-success-soft text-success",
                state === "todo" && "bg-surface text-content-muted",
              )}
            >
              {state === "done" ? (
                <Icon name="check" className="size-3.5" />
              ) : (
                step
              )}
            </span>
            <span className="truncate">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
