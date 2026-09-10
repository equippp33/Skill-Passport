import { Brand } from "~/components/brand";
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
 * Persistent desktop navigation and a compact mobile menu share the same routes.
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

      <div data-print-hide>
        <AdminSidebar signOut={m.app.signOut} />
      </div>

      <div className="lg:pl-64 print:pl-0">
        <header
          data-print-hide
          className="sticky top-0 z-20 border-b border-border-subtle bg-surface"
        >
          <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8 lg:px-10">
            {/* Only shown where the rail is hidden. */}
            <Link
              href="/admin"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight lg:hidden"
            >
              <Brand className="gap-2 [&>svg]:size-8 [&>span]:text-base" />
            </Link>
            <span className="hidden text-sm font-medium text-content-muted lg:block">
              Interview workspace
            </span>

            <div className="flex items-center gap-3">
              <span className="hidden max-w-64 truncate text-sm text-content-muted sm:inline">
                {admin.email}
              </span>
              <form action={logoutAction} className="lg:hidden">
                <Button type="submit" variant="secondary" size="sm">
                  {m.app.signOut}
                </Button>
              </form>
            </div>
          </div>
          <AdminSidebar mobile />
        </header>

        <main
          id="main"
          className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-8 sm:py-9 lg:px-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
