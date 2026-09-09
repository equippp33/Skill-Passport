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
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      lang={lang.code}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{m.app.name}</h1>
          <p className="mt-1 text-sm text-content-muted">{m.signup.intro}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{m.signup.title}</CardTitle>
            <CardDescription>{m.signup.subtitle}</CardDescription>
          </CardHeader>
          <CardContent>
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
      </div>
    </main>
  );
}
