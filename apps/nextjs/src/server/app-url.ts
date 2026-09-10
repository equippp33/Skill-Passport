import "server-only";

import { headers } from "next/headers";

import { env } from "~/env";

/**
 * Where this app lives in production.
 *
 * Hardcoded so a deployment needs no configuration to produce correct
 * candidate links — there is one public domain, and it is not a secret.
 * `APP_URL` still overrides it, which is the thing to reach for if the
 * domain ever changes or a second environment appears; changing it here
 * means a rebuild, changing the variable does not.
 */
const PRODUCTION_ORIGIN = "https://skillpassport.threepointolabs.com";

/**
 * The origin this app is reachable at, from the server's point of view.
 *
 * Anything the app hands to a human — a candidate link, most obviously —
 * has to be absolute and has to point at the real deployment. The browser
 * knows its own origin, but building links there means the URL is whatever
 * host that particular admin happened to load, and it is not available
 * until hydration.
 *
 * Resolution order, most trustworthy first:
 *
 *  1. `APP_URL`. Explicit, and the only source that is neither compiled in
 *     nor derived from a request.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL` — the platform's
 *     own answer, correct for preview deployments where the host changes
 *     per build.
 *  3. `PRODUCTION_ORIGIN`, once `NODE_ENV` says this is production. Taken
 *     before the request headers deliberately: `Host` is supplied by the
 *     client, so trusting it in production would let a forged request mint
 *     a candidate link pointing at someone else's site.
 *  4. The forwarded headers on the current request — how development gets
 *     `localhost`, and how any other host answers for itself.
 *  5. `http://localhost:<PORT>`, when there is no request at all, such as
 *     in a script.
 */
export async function appUrl(): Promise<string> {
  if (env.APP_URL) return env.APP_URL;

  const fromPlatform =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (fromPlatform) return `https://${stripSlash(fromPlatform)}`;

  if (env.NODE_ENV === "production") return PRODUCTION_ORIGIN;

  const fromRequest = await originFromRequest();
  if (fromRequest) return fromRequest;

  return `http://localhost:${process.env.PORT ?? "3000"}`;
}

/** An absolute URL for a path on this app. */
export async function absoluteUrl(path: string): Promise<string> {
  const base = await appUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Read the origin off the request.
 *
 * `x-forwarded-*` come first because behind a proxy the `host` header is the
 * internal one. The protocol has to be inferred rather than assumed: getting
 * it wrong turns every shared link into a redirect at best, and a broken
 * link at worst.
 */
async function originFromRequest(): Promise<string | null> {
  let requestHeaders: Awaited<ReturnType<typeof headers>>;
  try {
    requestHeaders = await headers();
  } catch {
    // Called outside a request — a script, or a statically rendered page.
    return null;
  }

  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProto?.split(",")[0]?.trim() ??
    // Nothing in front of us: a local address is plain http, anything else
    // is assumed to be terminated over TLS.
    (isLocal(host) ? "http" : "https");

  return `${protocol}://${stripSlash(host)}`;
}

function isLocal(host: string): boolean {
  const name = host.split(":")[0] ?? "";
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
