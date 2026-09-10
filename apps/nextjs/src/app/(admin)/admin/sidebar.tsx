"use client";
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
}: {
  mobile?: boolean;
  signOut?: string;
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
          "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors lg:justify-start lg:gap-3",
          active
            ? "bg-accent-soft text-accent"
            : "text-content-muted hover:bg-surface-muted hover:text-content",
        )}
      >
        <Icon name={item.icon} className="size-5 shrink-0" />
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
      className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border-subtle bg-surface lg:flex"
    >
      <Link href="/admin" className="px-6 py-7">
        <Brand />
      </Link>
      <p className="px-7 pt-5 pb-3 text-xs font-semibold tracking-wider text-content-muted uppercase">
        Workspace
      </p>
      <nav className="flex-1 space-y-1.5 px-4">{links}</nav>
      <div className="mx-4 mb-5 rounded-2xl border border-border-subtle bg-canvas p-4">
        <Icon name="spark" className="mb-3 text-accent" />
        <p className="text-sm font-semibold">A clearer picture of skills.</p>
        <p className="mt-1 text-xs leading-relaxed text-content-muted">
          One interview. Ten workplace skills. Meaningful feedback.
        </p>
      </div>
      <form action={logoutAction} className="border-t border-border-subtle p-4">
        <button
          type="submit"
          className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <Icon name="logout" />
          {signOut}
        </button>
      </form>
    </aside>
  );
}
