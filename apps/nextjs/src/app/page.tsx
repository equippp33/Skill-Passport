import { redirect } from "next/navigation";

import { getAuth } from "~/server/auth/session";

/**
 * There is no public home page: staff go to the admin area, candidates arrive
 * on a share link and never see this route.
 */
export default async function RootPage() {
  const { user } = await getAuth();
  redirect(user ? "/admin" : "/login");
}
