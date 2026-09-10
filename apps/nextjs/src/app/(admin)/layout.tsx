import Link from "next/link";

import { Button } from "~/components/ui";
import { logoutAction } from "~/server/auth/actions";
import { requireAdmin } from "~/server/admin/service";
import { uiMessages } from "~/server/language";
import { AdminSidebar } from "./admin/sidebar";

/**
 * Admin shell.
 *
 * `requireAdmin` runs here so no page under `(admin)` can render without the
 * role, even if a child forgets to check. Each server action re-checks too —
 * a layout guard does not protect an action endpoint.
 *
 * The rail is `fixed`, so the content column carries a matching left padding
 * rather than sitting in a flex row: that way hovering the rail open overlays
 * the page instead of reflowing it.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin("/admin");
  const m = uiMessages();

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        {m.app.skipToContent}
      </a>

      <AdminSidebar />

      <div className="lg:pl-16">
        <header className="sticky top-0 z-20 border-b border-border-subtle bg-canvas/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-8">
            {/* Only shown where the rail is hidden. */}
            <Link
              href="/admin"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight lg:hidden"
            >
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-lg bg-linear-to-br from-accent to-accent-hover text-[10px] font-bold text-accent-contrast"
              >
                SP
              </span>
              {m.app.name}
            </Link>
            <span className="hidden lg:block" />

            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-content-muted sm:inline">
                {admin.email}
              </span>
              <form action={logoutAction} className="lg:hidden">
                <Button type="submit" variant="secondary" size="sm">
                  {m.app.signOut}
                </Button>
              </form>
            </div>
          </div>
        </header>

        <main
          id="main"
          className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
