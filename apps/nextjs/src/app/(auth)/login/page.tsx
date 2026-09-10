import { AuthShell } from "~/components/auth-shell";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
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
    <AuthShell m={m} lang={lang.code}>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pt-0 pb-7">
          <h1 className="text-3xl leading-snug font-semibold tracking-tight">
            {m.login.title}
          </h1>
          <CardDescription>{m.login.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
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
    </AuthShell>
  );
}
