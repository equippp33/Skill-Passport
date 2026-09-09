"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "~/server/db";
import { usersTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { loginSchema, signupSchema } from "~/server/interview/validation";
import { lucia } from "./lucia";
import { hashPassword, verifyPassword } from "./password";
import { getAuth } from "./session";
import { EMAIL_TAKEN, isUniqueViolation } from "~/lib/auth-errors";

export interface AuthFormState {
  error: string | null;
  fieldErrors?: Record<string, string>;
}

/** Only allow relative paths, so `?next=` cannot become an open redirect. */
function safeRedirectTarget(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/admin";
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: null, fieldErrors };
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, parsed.data.email),
  });

  // Same message and comparable work either way: do not reveal whether the
  // address exists, and do not short-circuit the hash comparison.
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, parsed.data.password)
    : await verifyPassword("scrypt$16384$8$1$00$00", parsed.data.password);

  if (!user || !passwordOk) {
    return { error: "Incorrect email or password." };
  }

  const session = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  const cookieStore = await cookies();
  cookieStore.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.attributes,
  );

  redirect(safeRedirectTarget(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  const { session } = await getAuth();
  if (session) await lucia.invalidateSession(session.id);

  const blank = lucia.createBlankSessionCookie();
  const cookieStore = await cookies();
  cookieStore.set(blank.name, blank.value, blank.attributes);

  redirect("/login");
}

/**
 * Create an account and sign straight in.
 *
 * Duplicate emails are caught from the unique index rather than a
 * check-then-insert: two simultaneous sign-ups with the same address would
 * both pass a prior existence check, and only the constraint is authoritative.
 */
export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { error: null, fieldErrors };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  let userId: string;
  try {
    const [created] = await db
      .insert(usersTable)
      .values({ email: parsed.data.email, passwordHash })
      .returning({ id: usersTable.id });

    if (!created) throw new Error("insert returned no row");
    userId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: null, fieldErrors: { email: EMAIL_TAKEN } };
    }
    console.error("[auth] signup failed", error);
    return { error: "Could not create your account. Please try again." };
  }

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  const cookieStore = await cookies();
  cookieStore.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.attributes,
  );

  redirect("/admin");
}
