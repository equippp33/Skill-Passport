# Skill Passport

pnpm + Turborepo monorepo for the Skill Passport web app.

## Layout

```
.
├── apps
│   └── nextjs    # Next.js 16 web app + AI interviews -> @skill-passport/nextjs
├── packages
│   └── shared    # Platform-agnostic shared code  -> @skill-passport/shared
└── tooling
    ├── eslint       # Shared ESLint preset       -> @skill-passport/eslint-config
    └── typescript   # Shared tsconfig presets     -> @skill-passport/tsconfig
```

## Prerequisites

- Node `>=22.14.0`
- pnpm `>=10.8.0` (`corepack enable pnpm`)

## Getting started

```bash
pnpm install

pnpm dev         # every app at once
pnpm dev:next    # Next.js only, http://localhost:3000
```

## Scripts

| Command                           | What it does                        |
| --------------------------------- | ----------------------------------- |
| `pnpm build`                      | Build every app                     |
| `pnpm dev`                        | Run every app in dev mode           |
| `pnpm lint`                       | ESLint across the workspace         |
| `pnpm typecheck`                  | `tsc --noEmit` across the workspace |
| `pnpm format` / `pnpm format:fix` | Prettier check / write              |
| `pnpm lint:ws`                    | Audit workspace deps with `sherif`  |
| `pnpm clean`                      | Remove all `node_modules`           |

## Running in Docker

```bash
docker build -t skill-passport .
docker run --rm -p 3000:3000 --env-file .env skill-passport
```

See [`docs/docker.md`](apps/nextjs/docs/docker.md) for the image layout,
migrations, and what to set in production.

## AI interview system (web app)

The Next.js app hosts a turn-based AI interview: a question is shown and
spoken, the candidate records an answer, the server transcribes it (Sarvam
STT), evaluates it and picks the next question (OpenAI), then synthesises that
question (Sarvam TTS). Everything AI- or database-related lives inside
`apps/nextjs`.

### The framework

It is a **general employability assessment**, not a technical screen. Every
interview covers ten workplace skills in a fixed order, defined once in
[`src/config/work-skills.ts`](apps/nextjs/src/config/work-skills.ts):

reliability · responsibility · following instructions · attention to detail ·
communication · teamwork · thinking and problem solving · learning and
adaptability · initiative · customer orientation

Turn `n` is mapped to a skill server-side, so coverage is deterministic and the
model cannot wander. The result page shows all ten scores, marking any
unanswered skill as "not assessed".

**There is no setup step.** The framework is fixed, so "Start new assessment"
on the dashboard creates the session and goes straight to the instructions —
no job role, experience level, length or focus is collected. Scenarios are
kept deliberately general (a shift, a team, a supervisor, a customer) since
the candidate role is unknown.

### Languages

Two independent switches:

```env
UI_LANGUAGE="english"        # app chrome
INTERVIEW_LANGUAGE="marathi" # the interview itself
```

| Setting              | Controls                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `UI_LANGUAGE`        | Login, dashboard, buttons, labels, section headings, instructions, page titles, `<html lang>`                                            |
| `INTERVIEW_LANGUAGE` | Questions, follow-ups, Sarvam STT, Sarvam TTS, answer evaluation, per-answer feedback, the final report — and the candidate speaks in it |

Rule of thumb: **anything the model wrote, or the candidate said, is in the
interview language; everything the app wrote is in the UI language.** On the
result page the headings are English while the summary, per-question
evaluations and transcripts render in Marathi, each marked with a `lang`
attribute so screen readers and font fallback behave.

The registry lives in
[`src/config/languages.ts`](apps/nextjs/src/config/languages.ts) and is the only
place language names and BCP-47 codes appear. It lists the 11 languages
supported by **both** Sarvam models (STT covers 24, TTS covers 11 — the
intersection is what an interview can actually use).

A language is selectable only when it also has a UI dictionary in
`src/config/messages/`. Today: **english, hindi, marathi**. Anything else is a
startup error naming the valid values — there is no silent fallback.

To add one: add the dictionary, then list the key in
`TRANSLATED_LANGUAGE_KEYS`. The `MESSAGES` record is typed against that list,
so a mismatch fails to compile.

The language is **frozen onto each session at creation**. Changing
`INTERVIEW_LANGUAGE` never alters an interview already under way, and the
candidate's transcript is stored verbatim in their own script — never
translated.

### One-time setup

Secrets live in the **monorepo root `.env`** (not in `apps/nextjs`). Every app
script that needs them is wrapped with `dotenv -e ../../.env --`, the same
convention the other ThreePointOLabs repos use.

```bash
cp apps/nextjs/.env.example .env                     # then fill in the values
pnpm --filter @skill-passport/nextjs db:migrate      # create the tables
pnpm --filter @skill-passport/nextjs user:create you@example.com "your-password"
pnpm dev:next                                        # http://localhost:3000
```

### Audio storage

Question and answer audio is stored in **Cloudflare R2**, in the dedicated
private bucket `ai-interview-recordings`, keyed as:

```
<prefix>/interviews/<sessionId>/<question|answer>/<audioId>.<ext>
```

Recordings are private and the bucket must stay that way — do not enable
public access on it. Playback goes through `/api/interview/audio/[audioId]`,
which verifies ownership and then redirects to a presigned URL valid for
5 minutes.

Sign in at `/login` and start an interview from `/interview`.

Candidates can self-register at `/signup` (email + password, same fields as
sign-in) and land on the dashboard signed in. `user:create` remains for
provisioning an account from the command line.

### Database commands

| Command       | What it does                                             |
| ------------- | -------------------------------------------------------- |
| `db:generate` | Write a new SQL migration from the schema (no DB needed) |
| `db:migrate`  | Apply pending migrations                                 |
| `db:push`     | Push the schema directly (dev only)                      |
| `db:studio`   | Open Drizzle Studio                                      |

Run them with `pnpm --filter @skill-passport/nextjs <command>`.

### Tests

`pnpm test` runs the unit suite. The interview integration tests (ownership,
duplicate submission, stale-turn recovery) need a live database and are
skipped without one:

```bash
pnpm --filter @skill-passport/nextjs test
```

With the root `.env` populated they run automatically; without a database or
R2 credentials they skip. They never call OpenAI or Sarvam.

## Conventions

- **Versions live in `pnpm-workspace.yaml`.** Shared dependency versions use pnpm
  catalogs — write `"typescript": "catalog:"` or `"react": "catalog:react19"`
  in a package instead of hardcoding a version, so every workspace stays in sync.
- **`node-linker=hoisted`** is set in `.npmrc`. It was originally required by
  Metro and is kept because the lockfile and the Docker build assume a flat
  `node_modules`. Moving to pnpm's default isolated linker is safe but needs a
  clean reinstall, so treat it as a deliberate change.
- **Shared code stays framework-agnostic.** `packages/shared` is consumed by
  Next.js via `transpilePackages` and must not import `next` or DOM globals,
  so it remains usable from a script, a worker, or a second app later. Put
  web-only code in the app, or add a dedicated package.
- **Workspace packages ship TypeScript source, not build output.** There is no
  build step for `packages/*`; the app bundlers compile them.

## Adding a package

```bash
mkdir -p packages/<name>/src
```

Give it a `package.json` named `@skill-passport/<name>` with
`"main": "./src/index.ts"`, extend `@skill-passport/tsconfig/internal-package.json`,
then add it to the consuming app's `dependencies` as `"workspace:*"`. For the
Next.js app, also add the name to `transpilePackages` in `apps/nextjs/next.config.ts`.

## Adding a dependency

```bash
pnpm add <pkg> --filter @skill-passport/nextjs
```

Versions shared across workspaces live in the `catalog:` block of
`pnpm-workspace.yaml`; reference them as `"catalog:"` rather than pinning
twice.
