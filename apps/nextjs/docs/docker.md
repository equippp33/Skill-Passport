# Running Skill Passport in Docker

```bash
docker build -t skill-passport .          # from the repo root
docker run --rm -p 3000:3000 --env-file .env skill-passport
```

The build context is the whole monorepo, not `apps/nextjs`, because the app
depends on `@skill-passport/shared` and on a lockfile that lives at the root.

## What the image contains

Next builds with `output: "standalone"`, which traces the modules a request
actually reaches and emits them next to a generated `server.js`. The runtime
stage copies only that: no pnpm, no repo, no `node_modules` beyond the traced
set, no source, no test files.

`outputFileTracingRoot` points at the repo root. Without it the trace would
start at `apps/nextjs` and miss every dependency, because `node-linker=hoisted`
puts them all in the root `node_modules`.

The layout inside the image mirrors the workspace, which is why the entrypoint
is `apps/nextjs/server.js` rather than `server.js`.

## Configuration

Nothing is baked in. `.env` is excluded by `.dockerignore` on purpose — the
image takes its configuration at runtime, so the same image can be promoted
between environments and a leaked image leaks no secrets.

The build runs with `NEXT_BUILD=1`, which is the escape hatch `src/env.ts`
provides so a build does not need production credentials. Validation still
happens for real when the server boots: a missing or malformed variable is a
loud failure at startup, not a broken request an hour later.

Required at runtime (see `apps/nextjs/.env.example` for the full list):

| Variable                            | Why                                |
| ----------------------------------- | ---------------------------------- |
| `DATABASE_URL`                      | Postgres                           |
| `SARVAM_API_KEY`                    | speech to text and text to speech  |
| `OPENAI_API_KEY`                    | question generation and evaluation |
| `CLOUDFLARE_R2_*`                   | recording storage                  |
| `UI_LANGUAGE`, `INTERVIEW_LANGUAGE` | app chrome and interview content   |

Candidate links use the production domain compiled into
`src/server/app-url.ts`, so a normal deployment needs no URL configuration.
Set `APP_URL` only to point somewhere else — a staging host, or a domain
change you would rather not rebuild for.

`PORT` and `HOSTNAME` are already set. `HOSTNAME=0.0.0.0` matters: Next's
default binds to localhost, which inside a container means nothing outside it
can connect.

## PDF export

The candidate report downloads as a PDF, rendered by the Chromium the
runtime stage installs. `CHROMIUM_PATH` already points at it.

The Noto font packages beside it are load-bearing, not padding: reports
carry whatever language the candidate answered in, and Alpine ships no
Indic fonts. Without them Hindi, Telugu and Tamil render as empty boxes —
the text is in the file and looks fine to a grep, and wrong to a reader.

Chromium is also the reason the image is a few hundred megabytes rather
than tens. It is the only way to get a real download with correct shaping
for these scripts; the JavaScript PDF libraries do no complex text layout
and would silently mangle every non-Latin transcript.

If Chromium is missing the app still runs — the export returns a 501 and
the button says so, rather than the page failing.

## Migrations

The image deliberately does not run them. Schema changes are a deploy step
with its own failure modes, and an app container that migrates on boot will
happily run the same migration from three replicas at once.

Run them from a checkout, pointed at the same database:

```bash
pnpm db:migrate
```

## Things worth knowing

- **The base image is pinned** to `node:22.14.0-alpine`. A floating tag makes
  an image that built yesterday and one that builds today two different
  artifacts.
- **`--frozen-lockfile`** means a lockfile that disagrees with the manifests
  fails the build rather than quietly resolving something else. If it fails,
  run `pnpm install` locally and commit the result.
- **The container runs as `nextjs` (uid 1001)**, not root.
- **`node` is PID 1**, so `SIGTERM` reaches it directly and the container
  stops promptly instead of waiting out the kill timeout.
- **Direct-to-R2 uploads need a CORS rule** on the bucket for whatever origin
  the container is served from. Without one the app still works — it falls
  back to relaying uploads through the server — but see
  [`r2-cors.md`](./r2-cors.md).
