/**
 * Start `next dev` without tripping over a port that is already taken.
 *
 * Two different things go wrong here and they need different answers:
 *
 *  - SOMETHING ELSE is on 3000 — another project, a stray process. Next
 *    passes the port straight to `listen()` and dies on EADDRINUSE, so this
 *    scans upward and hands it one that is free.
 *  - A DEV SERVER FOR THIS PROJECT is already running. Next refuses that on
 *    any port, so moving to 3001 just produces a second, more confusing
 *    error. Point at the one that is running instead.
 *
 *   pnpm dev              # 3000, or 3001, or 3002…
 *   PORT=4000 pnpm dev    # starts scanning at 4000
 *   pnpm dev --turbo      # extra flags are passed through
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const PREFERRED = Number(process.env.PORT) || 3000;
const ATTEMPTS = 20;
const LOCK = path.join(process.cwd(), ".next", "dev", "lock");

/** The dev server Next thinks is running, if it really is. */
function runningServer() {
  let lock;
  try {
    lock = JSON.parse(readFileSync(LOCK, "utf8"));
  } catch {
    // No lock, or unreadable: nothing is holding the project.
    return null;
  }
  if (typeof lock?.pid !== "number") return null;

  try {
    // Signal 0 checks for existence without touching the process. EPERM
    // means it exists and is not ours, which still counts as running.
    process.kill(lock.pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return null;
  }
  return lock;
}

/**
 * Whether a port can be bound.
 *
 * Binds the way Next does — no host, so the OS picks the dual-stack
 * wildcard — because a port free on 127.0.0.1 can still be taken on `::`,
 * and that mismatch is the failure this exists to prevent.
 */
function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function firstFreePort() {
  for (let port = PREFERRED; port < PREFERRED + ATTEMPTS; port += 1) {
    if (await isFree(port)) return port;
  }
  return null;
}

const running = runningServer();
if (running) {
  const stop =
    process.platform === "win32"
      ? `taskkill /PID ${running.pid} /F`
      : `kill ${running.pid}`;
  console.error(
    `A dev server for this project is already running.\n\n` +
      `  ${running.appUrl ?? `http://localhost:${running.port}`}  (PID ${running.pid})\n\n` +
      `Use it, or stop it and run this again:\n\n  ${stop}\n`,
  );
  process.exit(1);
}

const port = await firstFreePort();
if (port === null) {
  console.error(
    `No free port between ${PREFERRED} and ${PREFERRED + ATTEMPTS - 1}. ` +
      `Something is holding a lot of ports — stop it, or set PORT.`,
  );
  process.exit(1);
}

if (port !== PREFERRED) {
  console.log(`Port ${PREFERRED} is in use — starting on ${port} instead.\n`);
}

// `next` rather than `npx next`: it is a direct dependency, so pnpm has
// already put its bin on PATH for this script.
const child = spawn(
  "next",
  ["dev", "--port", String(port), ...process.argv.slice(2)],
  { stdio: "inherit", shell: process.platform === "win32" },
);

// Forward what the terminal sends, so Ctrl+C stops Next rather than
// orphaning it — which is how a port gets stuck in the first place.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
