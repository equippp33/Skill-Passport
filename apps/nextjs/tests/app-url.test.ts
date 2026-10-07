import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which origin ends up in a candidate link.
 *
 * The link is the whole product for a candidate — get this wrong and the
 * interview is unreachable, or reachable at somewhere it should not be — and
 * every input is ambient (env vars, request headers), so it is worth pinning
 * each case rather than trusting a read-through.
 */

/** What the current request claims to be. Set per test. */
let requestHeaders: Record<string, string> = {};

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({ get: (key: string) => requestHeaders[key] ?? null }),
}));

const DOMAIN = "https://skillpassport.threepointolabs.com";

/** `~/env` snapshots process.env when it loads, so re-import after stubbing. */
async function load() {
  vi.resetModules();
  return import("~/server/app-url");
}

describe("origin used in candidate links", () => {
  beforeEach(() => {
    // `stubEnv` rather than assignment: NODE_ENV is typed read-only.
    vi.stubEnv("APP_URL", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
    requestHeaders = {};
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses localhost in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    requestHeaders = { host: "localhost:3000" };

    const { appUrl } = await load();
    expect(await appUrl()).toBe("http://localhost:3000");
  });

  it("uses the compiled domain in production, with nothing configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requestHeaders = { host: "skillpassport.threepointolabs.com" };

    const { appUrl } = await load();
    expect(await appUrl()).toBe(DOMAIN);
  });

  /**
   * The reason the compiled domain is consulted before the headers: a
   * request can claim any Host it likes, and a link built from one would
   * look entirely legitimate to the admin who copied it.
   */
  it("ignores a spoofed Host in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requestHeaders = {
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    };

    const { appUrl } = await load();
    expect(await appUrl()).toBe(DOMAIN);
  });

  it("still lets APP_URL override, for a staging host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://staging.example.com");

    const { appUrl } = await load();
    expect(await appUrl()).toBe("https://staging.example.com");
  });

  it("strips a trailing slash so links never double up", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://staging.example.com/");

    const { absoluteUrl } = await load();
    expect(await absoluteUrl("/i/abc")).toBe(
      "https://staging.example.com/i/abc",
    );
  });

  it("gives a preview deployment its own URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_URL", "sp-abc123.vercel.app");

    const { appUrl } = await load();
    expect(await appUrl()).toBe("https://sp-abc123.vercel.app");
  });

  it("honours a proxy's forwarded host outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    requestHeaders = {
      host: "internal:3000",
      "x-forwarded-host": "tunnel.example.dev",
      "x-forwarded-proto": "https",
    };

    const { appUrl } = await load();
    expect(await appUrl()).toBe("https://tunnel.example.dev");
  });
});
