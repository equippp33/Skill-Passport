import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { usersTable } from "~/server/db/schema";
import { getAuth } from "~/server/auth/session";
import { recentActivity } from "~/server/services/dev-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only feed of which service served each leg of the interview.
 *
 * The interview page gets this on its own status poll; the admin area has no
 * such poll, so it reads from here instead — letting you watch an interview's
 * provider activity from the admin side while a candidate sits it elsewhere.
 *
 * Two independent gates. Outside development this 404s, exactly as if the
 * route did not exist, and `recentActivity()` would return an empty array in
 * any case. Inside development it still requires an admin session, so it is
 * not an unauthenticated window onto what the app is doing.
 */
export async function GET(): Promise<Response> {
  if (env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Role re-read from the database rather than trusted from the session, the
  // same rule `requireAdmin` follows.
  const row = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, user.id),
    columns: { role: true },
  });
  if (row?.role !== "admin") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json(
    { events: recentActivity() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
