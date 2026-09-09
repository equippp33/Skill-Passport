import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import { getAuth } from "~/server/auth/session";
import { uiLanguage, uiMessages } from "~/server/language";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: uiMessages().login.title };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { user } = await getAuth();
  const { next } = await searchParams;
  const m = uiMessages();
  const lang = uiLanguage();

  // Only relative paths are honoured, so `next` cannot bounce to another host.
  const safeNext =
    next?.startsWith("/") && !next.startsWith("//") ? next : undefined;

  if (user) redirect(safeNext ?? "/admin");

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      lang={lang.code}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{m.app.name}</h1>
          <p className="mt-1 text-sm text-content-muted">{m.login.intro}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{m.login.title}</CardTitle>
            <CardDescription>{m.login.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={safeNext} m={m} />
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-content-muted">
          {m.login.noAccount}{" "}
          <Link
            href="/signup"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {m.login.signUpLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
