import Link from "next/link";

import { buttonClasses } from "~/components/ui";
import { getAuth } from "~/server/auth/session";
import { uiMessages } from "~/server/language";

/**
 * Global 404.
 *
 * Without this, Next renders its built-in page, which follows the operating
 * system theme and so appears dark inside a deliberately light-only app.
 *
 * Where it points depends on who is asking: staff get the dashboard, everyone
 * else gets sign-in. A candidate who mistypes a share link is told to go back
 * to the link they were sent, since there is nothing here for them to browse.
 */
export default async function NotFound() {
  const { user } = await getAuth();
  const m = uiMessages();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-medium text-content-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-content-muted">
          {user
            ? "That page does not exist. Interviews are managed from the dashboard."
            : "That page does not exist. If you were sent an interview link, open that link again."}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {user ? (
            <Link href="/admin" className={buttonClasses("primary", "md")}>
              Go to dashboard
            </Link>
          ) : (
            <Link href="/login" className={buttonClasses("primary", "md")}>
              {m.login.title}
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
