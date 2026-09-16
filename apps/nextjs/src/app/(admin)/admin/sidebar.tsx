"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "~/components/brand";
import { Icon } from "~/components/ui/icon";
import { logoutAction } from "~/server/auth/actions";
import { cn } from "~/lib/utils";

const items = [
  { href: "/admin", label: "Overview", icon: "grid" },
  { href: "/admin/interviews", label: "Interviews", icon: "mic" },
  { href: "/admin/reports", label: "Reports", icon: "report" },
] as const;

export function AdminSidebar({
  mobile = false,
  signOut = "Sign out",
  email,
}: {
  mobile?: boolean;
  signOut?: string;
  /** Shown as the profile at the foot of the desktop rail. */
  email?: string;
}) {
  const pathname = usePathname();
  const links = items.map((item) => {
    const active =
      item.href === "/admin"
        ? pathname === item.href
        : pathname.startsWith(item.href) ||
          (item.icon === "report" && pathname.startsWith("/admin/attempts"));
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-9 items-center justify-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors lg:justify-start",
          active
            ? "bg-accent-soft text-accent"
            : "text-content-muted hover:bg-surface-muted hover:text-content",
        )}
      >
        <Icon name={item.icon} className="size-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  });
  if (mobile)
    return (
      <nav
        aria-label="Admin navigation"
        className="grid grid-cols-3 gap-1 border-t border-border-subtle bg-surface px-3 py-2 lg:hidden"
      >
        {links}
      </nav>
    );
  return (
    <aside
      aria-label="Admin navigation"
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border-subtle bg-surface lg:flex"
    >
      <Link href="/admin" className="px-4 py-4">
        <Brand />
      </Link>
      <nav className="flex-1 space-y-0.5 px-2.5">{links}</nav>
      <ProfileMenu email={email} signOut={signOut} />
    </aside>
  );
}

/** Email as the trigger; a menu opens above it with reset-password + sign-out. */
function ProfileMenu({
  email,
  signOut,
}: {
  email?: string;
  signOut: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-border-subtle p-2.5">
      {open ? (
        <div
          role="menu"
          className="absolute right-2.5 bottom-full left-2.5 mb-1 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-[var(--shadow-raised)]"
        >
          <Link
            href="/admin/reset-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
          >
            <Icon name="shield" className="size-4 shrink-0" />
            Reset password
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-soft"
            >
              <Icon name="logout" className="size-4 shrink-0" />
              {signOut}
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted"
      >
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-content"
          title={email}
        >
          {email ?? "Account"}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={cn(
            "size-4 shrink-0 text-content-muted transition-transform",
            open && "rotate-180",
          )}
        >
          <path d="m6 8 4 4 4-4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
