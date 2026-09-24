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
        <AdminSidebar signOut={m.app.signOut} email={admin.email} />
      </div>

      <div className="lg:pl-60 print:pl-0">
        {/* Mobile only — the desktop rail carries the brand, nav and profile,
            so there is nothing for a top bar to do there. */}
        <header
          data-print-hide
          className="sticky top-0 z-20 border-b border-border-subtle bg-surface lg:hidden"
        >
          <div className="flex min-h-14 w-full items-center justify-between gap-3 px-4 sm:px-6">
            <Link
              href="/admin"
              className="flex items-center gap-2 text-sm font-semibold tracking-tight"
            >
              <Brand className="h-8" />
            </Link>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" size="sm">
                {m.app.signOut}
              </Button>
            </form>
          </div>
          <AdminSidebar mobile />
        </header>

        <main
          id="main"
          className="w-full space-y-4 px-4 py-4 sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
