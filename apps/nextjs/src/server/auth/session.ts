import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session, User } from "lucia";

import { lucia } from "./lucia";

export interface AuthState {
  user: User | null;
  session: Session | null;
}

/**
 * Validate the Lucia session cookie for the current request.
 *
 * `cache()` dedupes this across a single render pass so a layout and its
 * pages share one database round-trip.
 *
 * Session cookie refresh is attempted but tolerated to fail: Next.js forbids
 * writing cookies from a Server Component render. Route Handlers and Server
 * Actions can write, so the rolling expiry is refreshed there.
 */
export const getAuth = cache(async (): Promise<AuthState> => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;
  if (!sessionId) return { user: null, session: null };

  const result = await lucia.validateSession(sessionId);

  try {
    if (result.session?.fresh) {
      const cookie = lucia.createSessionCookie(result.session.id);
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
    if (!result.session) {
      const cookie = lucia.createBlankSessionCookie();
      cookieStore.set(cookie.name, cookie.value, cookie.attributes);
    }
  } catch {
    // Server Component render — cookies are read-only here. Safe to ignore.
  }

  return result;
});

/** Returns the signed-in user, or redirects to login. For pages. */
export async function requireUser(returnTo?: string): Promise<User> {
  const { user } = await getAuth();
  if (!user) {
    const target = returnTo
      ? `/login?next=${encodeURIComponent(returnTo)}`
      : "/login";
    redirect(target);
  }
  return user;
}

/** Returns the signed-in user or null. For Route Handlers / Server Actions. */
export async function getUser(): Promise<User | null> {
  const { user } = await getAuth();
  return user;
}
