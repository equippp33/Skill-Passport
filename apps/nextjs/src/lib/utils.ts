import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** `95` -> `1:35`. Used by the recording timer and duration labels. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * How long something took, in words: `24 min`, `1 hr 5 min`, `48 sec`.
 *
 * Deliberately not `formatDuration`'s `m:ss` — that reads as a clip length,
 * and a 75-minute interview rendering as `75:12` invites being misread as
 * hours. Returns an em dash when either end is missing (an interview still in
 * progress has no completion time) or when the clock ran backwards.
 */
export function formatSpan(
  from: Date | string | null,
  to: Date | string | null,
): string {
  if (!from || !to) return "—";
  const start = typeof from === "string" ? new Date(from) : from;
  const end = typeof to === "string" ? new Date(to) : to;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";

  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (seconds < 0) return "—";
  if (seconds < 60) return `${seconds} sec`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Date and time to the minute.
 *
 * Used where the ordering of things within one sitting matters — which
 * answer came when — and a date alone would say nothing.
 */
export function formatDateTime(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
