import * as React from "react";

import { Icon } from "./icon";
import { cn } from "~/lib/utils";

/**
 * Minimal, dependency-free UI primitives.
 *
 * The app had no component library, so this is a small set built on the design
 * tokens in `globals.css`. They are intentionally plain elements with
 * forwarded props, so `aria-*`, `id`, and event handlers pass straight
 * through and keyboard behaviour stays native.
 */

/* --------------------------------- Button -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-contrast shadow-[var(--shadow-card)] hover:bg-accent-hover",
  secondary:
    "bg-surface text-content border border-border-strong shadow-[var(--shadow-card)] hover:bg-surface-muted",
  ghost: "text-content-muted hover:bg-surface-muted hover:text-content",
  danger:
    "bg-danger text-white shadow-[var(--shadow-card)] hover:brightness-95",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-sm",
  lg: "min-h-12 px-6 py-3 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", size = "md", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          // Tailwind v4's preflight sets buttons to `cursor: default`, so the
          // pointer has to be explicit. `disabled:` comes after, and wins.
          "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
          buttonVariants[variant],
          buttonSizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);

const buttonBase =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Anchor styled as a button. Navigation must be a real link (focusable,
 * middle-clickable, announced as a link) — never a `<button>` wrapping one.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-border-subtle bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-5 pt-5 pb-3 sm:px-6 sm:pt-6", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("mt-1 text-sm text-content-muted", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 pb-5 sm:px-6 sm:pb-6", className)} {...props} />
  );
}

/* --------------------------------- Inputs -------------------------------- */

const fieldStyles =
  "min-h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface px-3.5 py-2.5 text-base text-content transition-colors placeholder:text-content-muted hover:border-content-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/10 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldStyles, className)} {...props} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(fieldStyles, "min-h-24 resize-y", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(fieldStyles, "cursor-pointer pr-8", className)}
      {...props}
    />
  );
});

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-content", className)}
      {...props}
    />
  );
}

/** Field-level error. Rendered as an alert so screen readers announce it. */
export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-danger">
      {children}
    </p>
  );
}

/* --------------------------------- Alert --------------------------------- */

type AlertTone = "info" | "danger" | "success" | "warning";

const alertTones: Record<AlertTone, string> = {
  info: "bg-accent-soft text-content border-accent/15",
  danger: "bg-danger-soft text-content border-danger/20",
  success: "bg-success-soft text-content border-success/20",
  warning: "bg-warning-soft text-content border-warning/25",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm leading-relaxed",
        alertTones[tone],
        className,
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

/* --------------------------------- Badge --------------------------------- */

const badgeTones: Record<string, string> = {
  not_started: "bg-surface-muted text-content-muted",
  in_progress: "bg-accent-soft text-accent",
  processing: "bg-warning-soft text-warning",
  completed: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
};

/**
 * The label is passed in rather than looked up here, so it comes from the
 * language dictionary instead of being hardcoded English in a primitive.
 */
export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        badgeTones[status] ?? "bg-surface-muted text-content-muted",
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      {label}
    </span>
  );
}

/* -------------------------------- Progress ------------------------------- */

export function Progress({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------- Skeleton ------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-muted", className)}
    />
  );
}

/* ------------------------------- Empty state ------------------------------ */

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  headingLevel?: 1 | 2;
}) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto max-w-sm">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Icon name="report" className="size-6" />
        </span>
        {headingLevel === 1 ? (
          <h1 className="text-xl font-semibold text-content">{title}</h1>
        ) : (
          <h2 className="text-base font-semibold text-content">{title}</h2>
        )}
        <p className="mt-1.5 text-sm leading-relaxed text-content-muted">
          {description}
        </p>
        {action ? (
          <div className="mt-6 flex justify-center">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
