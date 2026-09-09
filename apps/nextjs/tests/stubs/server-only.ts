// `server-only` throws by design outside a React Server Component. Tests
// exercise the server modules directly in Node, so it is aliased to this
// no-op in vitest.config.ts.
export {};
