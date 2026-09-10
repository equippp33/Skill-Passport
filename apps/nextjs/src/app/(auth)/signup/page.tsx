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
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: uiMessages().signup.title };
}

export default async function SignupPage() {
  const { user } = await getAuth();
  const m = uiMessages();
  const lang = uiLanguage();

  // Already signed in — nothing to create.
  if (user) redirect("/admin");

  return (
    <AuthShell m={m} lang={lang.code}>
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pt-0 pb-7">
          <h1 className="text-3xl leading-snug font-semibold tracking-tight">
            {m.signup.title}
          </h1>
          <CardDescription>{m.signup.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <SignupForm m={m} />
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-sm text-content-muted">
        {m.signup.haveAccount}{" "}
        <Link
          href="/login"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          {m.signup.signInLink}
        </Link>
      </p>
    </AuthShell>
  );
}
