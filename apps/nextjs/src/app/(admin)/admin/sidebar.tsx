"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "~/server/auth/actions";
import { cn } from "~/lib/utils";

/**
 * Collapsed icon rail that expands on hover.
 *
 * Behaviour notes that matter more than they look:
 *  - hover alone would strand keyboard users, so `focus-within` expands it
 *    too and labels stay in the DOM (dimmed, not removed) so screen readers
 *    always announce them;
 *  - it is `fixed` and overlays the page when open rather than pushing the
 *    content sideways, which would reflow the whole layout on every hover;
 *  - the rail hides entirely below `lg`, where a 64px permanent gutter costs
 *    more than it gives. The header link is the way back on a phone.
 */

const RAIL = "4rem";
const OPEN = "15rem";

function IconDashboard() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconInterviews() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        strokeLinecap="round"
      />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function IconReports() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" strokeLinejoin="round" />
      <path d="M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  );
}

function IconSignOut() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SECTIONS: {
  heading: string | null;
  items: {
    href: string;
    label: string;
    exact: boolean;
    icon: () => React.ReactElement;
  }[];
}[] = [
  {
    heading: null,
    items: [
      { href: "/admin", label: "Dashboard", exact: true, icon: IconDashboard },
      {
        href: "/admin/interviews",
        label: "Interviews",
        exact: false,
        icon: IconInterviews,
      },
      {
        href: "/admin/reports",
        label: "Reports",
        exact: false,
        icon: IconReports,
      },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Admin navigation"
      style={
        {
          "--rail": RAIL,
          "--open": OPEN,
        } as React.CSSProperties
      }
      className={cn(
        "group/rail fixed inset-y-0 left-0 z-30 hidden lg:flex",
        "w-[var(--rail)] hover:w-[var(--open)] focus-within:w-[var(--open)]",
        "flex-col overflow-hidden border-r border-border-subtle bg-surface",
        "transition-[width] duration-200 ease-out",
        "shadow-[var(--shadow-card)]",
      )}
    >
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-hover text-[11px] font-bold text-accent-contrast"
        >
          SP
        </span>
        <span
          className={cn(
            "truncate text-sm font-semibold tracking-tight whitespace-nowrap",
            "opacity-0 transition-opacity duration-200",
            "group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
          )}
        >
          Skill Passport
        </span>
      </div>

      <nav className="flex-1 space-y-6 px-2 py-2">
        {SECTIONS.map((section, i) => (
          <div key={i} className="space-y-1">
            {section.heading ? (
              <p
                className={cn(
                  "px-3 pb-1 text-[10px] font-semibold tracking-widest text-content-muted uppercase",
                  "opacity-0 transition-opacity duration-200",
                  "group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
                )}
              >
                {section.heading}
              </p>
            ) : null}

            {section.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-content-muted hover:bg-surface-muted hover:text-content",
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <Icon />
                  </span>
                  <span
                    className={cn(
                      "truncate text-sm font-medium whitespace-nowrap",
                      active && "font-semibold",
                      "opacity-0 transition-opacity duration-200",
                      "group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-border-subtle px-2 py-3">
        <p
          className={cn(
            "px-3 pb-1 text-[10px] font-semibold tracking-widest text-content-muted uppercase",
            "opacity-0 transition-opacity duration-200",
            "group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
          )}
        >
          Account
        </p>

        {/* A server action posted from a client component — no extra
            round-trip and no state to keep in sync. */}
        <form action={logoutAction}>
          <button
            type="submit"
            className={cn(
              "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5",
              "text-content-muted transition-colors hover:bg-danger-soft hover:text-danger",
            )}
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <IconSignOut />
            </span>
            <span
              className={cn(
                "truncate text-sm font-medium whitespace-nowrap",
                "opacity-0 transition-opacity duration-200",
                "group-hover/rail:opacity-100 group-focus-within/rail:opacity-100",
              )}
            >
              Sign out
            </span>
          </button>
        </form>
      </div>
    </aside>
  );
}
