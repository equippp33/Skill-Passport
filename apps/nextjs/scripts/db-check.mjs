/**
 * Pre-flight check before `db:migrate`. Read-only: it never writes to the
 * database or to the drizzle/ folder.
 *
 *   pnpm --filter @skill-passport/nextjs db:check
 *
 * Answers, in order:
 *  1. Are the migration files consistent? (every .sql is in the journal and
 *     vice versa, every entry has a snapshot, timestamps only go forward)
 *  2. Has schema.ts changed without `db:generate`? (runs generate into a temp
 *     copy of drizzle/ and sees whether it would produce a new migration)
 *  3. Which database is this pointed at, and what will `db:migrate` actually do
 *     there? Lists the pending migrations with their SQL and flags risky
 *     statements, already-applied files that were edited afterwards, and
 *     migrations drizzle would silently SKIP.
 *
 * Exits 1 if anything would make the migration fail or go wrong, so it can
 * gate a deploy: `pnpm db:check && pnpm db:migrate`.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

// Same lookup order as drizzle.config.ts, so we check the database that
// `db:migrate` will actually touch.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: "../../.env", quiet: true });

const MIGRATIONS_DIR = "drizzle";
const SCHEMA_FILE = "./src/server/db/schema.ts";
// drizzle-orm's defaults; drizzle.config.ts does not override them.
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

let errors = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ${GREEN}✓${OFF} ${msg}`);
const warn = (msg) => {
  warnings += 1;
  console.log(`  ${YELLOW}!${OFF} ${msg}`);
};
const fail = (msg) => {
  errors += 1;
  console.log(`  ${RED}✗${OFF} ${msg}`);
};
const info = (msg) => console.log(`  ${DIM}${msg}${OFF}`);
const heading = (title) => console.log(`\n${BOLD}=== ${title} ===${OFF}`);

/**
 * Statements worth a second look before they run against real data. Each test
 * sees one statement (comments stripped) plus the tables the same migration
 * creates, so rules about existing rows can ignore brand-new tables.
 */
const RISKY = [
  [(s) => /\bDROP\s+TABLE\b/i.test(s), "drops a table (data loss)"],
  [(s) => /\bDROP\s+COLUMN\b/i.test(s), "drops a column (data loss)"],
  [(s) => /\bDROP\s+TYPE\b/i.test(s), "drops a type"],
  [(s) => /\bTRUNCATE\b/i.test(s), "truncates a table (data loss)"],
  [(s) => /\bDELETE\s+FROM\b/i.test(s), "deletes rows"],
  [
    (s) => /\bSET\s+NOT\s+NULL\b/i.test(s),
    "adds NOT NULL — fails if existing rows hold NULL",
  ],
  [
    (s) =>
      /\bADD\s+COLUMN\b/i.test(s) &&
      /\bNOT\s+NULL\b/i.test(s) &&
      !/\bDEFAULT\b/i.test(s),
    "adds a NOT NULL column with no default — fails on a non-empty table",
  ],
  [
    (s) => /\bALTER\s+COLUMN\b.*\bTYPE\b/is.test(s),
    "changes a column type — may fail or lock",
  ],
  [
    (s) => /\bRENAME\b/i.test(s),
    "renames something — old app code may break mid-deploy",
  ],
  [
    (s, created) => {
      const m = /\bCREATE\s+UNIQUE\s+INDEX\b.*?\bON\s+"?(\w+)"?/is.exec(s);
      return m !== null && !created.has(m[1]);
    },
    "unique index on an existing table — fails if duplicates exist",
  ],
];

/** Split a migration into statements, comments removed. */
function statements(content) {
  return content
    .replace(/--[^\n]*/g, "")
    .split(/;|--> statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function riskyFindings(content) {
  const stmts = statements(content);
  const created = new Set(
    stmts
      .map(
        (s) =>
          /\bCREATE\s+TABLE\b(?:\s+IF\s+NOT\s+EXISTS)?\s+"?(\w+)"?/i.exec(
            s,
          )?.[1],
      )
      .filter(Boolean),
  );
  const found = new Set();
  for (const s of stmts) {
    for (const [test, why] of RISKY) {
      if (test(s, created)) found.add(why);
    }
  }
  return [...found];
}

/* ----------------------------- 1. Files ---------------------------------- */

function checkFiles() {
  heading("Migration files");

  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    fail(`${journalPath} not found — run from apps/nextjs.`);
    return null;
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = journal.entries;
  const tags = new Set(entries.map((e) => e.tag));

  const sqlFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4));

  for (const file of sqlFiles) {
    if (!tags.has(file)) {
      fail(
        `${file}.sql is not in the journal — db:migrate will NEVER run it. ` +
          `Delete it, or recreate it with \`drizzle-kit generate --custom\`.`,
      );
    }
  }

  const migrations = [];
  let previousWhen = 0;
  for (const entry of entries) {
    const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      fail(
        `journal entry ${entry.tag} has no ${sqlPath} — migrate will crash.`,
      );
      continue;
    }
    const prefix = entry.tag.split("_")[0];
    const snapshot = path.join(
      MIGRATIONS_DIR,
      "meta",
      `${prefix}_snapshot.json`,
    );
    if (!fs.existsSync(snapshot)) {
      warn(`${entry.tag} has no ${snapshot} — the next generate may be wrong.`);
    }
    if (entry.when <= previousWhen) {
      fail(
        `${entry.tag} is timestamped before the migration above it — drizzle ` +
          `would skip it on any database that already has the earlier one.`,
      );
    }
    previousWhen = entry.when;

    const content = fs.readFileSync(sqlPath, "utf8");
    migrations.push({
      tag: entry.tag,
      when: entry.when,
      content,
      // Identical to drizzle-orm's readMigrationFiles, so it matches the DB.
      hash: crypto.createHash("sha256").update(content).digest("hex"),
    });
  }

  if (errors === 0) ok(`${migrations.length} migrations, journal consistent`);
  return migrations;
}

/* ------------------------ 2. Schema vs migrations ------------------------ */

function checkSchemaDrift() {
  heading("Schema vs migrations");

  // Generate into a throwaway copy so the real drizzle/ folder is untouched.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-check-"));
  try {
    fs.cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
    const before = new Set(fs.readdirSync(tmp));
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "drizzle-kit",
        "generate",
        "--dialect=postgresql",
        `--schema=${SCHEMA_FILE}`,
        `--out=${tmp}`,
        "--casing=snake_case",
        "--name=db_check_probe",
      ],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
    if (result.status !== 0) {
      fail("drizzle-kit generate failed:");
      console.log((result.stderr || result.stdout || "").trim());
      return;
    }
    const added = fs
      .readdirSync(tmp)
      .filter((f) => !before.has(f) && f.endsWith(".sql"));
    if (added.length === 0) {
      ok("schema.ts matches the migrations");
      return;
    }
    fail(
      "schema.ts has changes with no migration — run `pnpm db:generate` and " +
        "commit the result. It would generate:",
    );
    console.log(indent(fs.readFileSync(path.join(tmp, added[0]), "utf8")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ----------------------------- 3. Database ------------------------------- */

async function checkDatabase(migrations) {
  heading("Database");

  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL is not set — nothing to check against.");
    return;
  }
  info(`target: ${describeUrl(url)}`);

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  });
  try {
    const [{ version }] = await sql`select version()`;
    ok(`connected (${version.split(",")[0]})`);

    const [{ exists }] = await sql`
      select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as exists`;
    const applied = exists
      ? await sql`
          select hash, created_at
          from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}
          order by created_at`
      : [];
    if (!exists) info("no migrations table yet — this is a fresh database");

    const appliedHashes = new Set(applied.map((r) => r.hash));
    const lastApplied = applied.length
      ? Number(applied[applied.length - 1].created_at)
      : 0;

    const pending = [];
    for (const m of migrations) {
      if (m.when > lastApplied) {
        pending.push(m);
      } else if (!appliedHashes.has(m.hash)) {
        // Either never run (and drizzle will skip it, since it only runs
        // migrations newer than the last one applied) or edited after it ran.
        const ranAtSameTime = applied.some(
          (r) => Number(r.created_at) === m.when,
        );
        if (ranAtSameTime) {
          warn(
            `${m.tag} was edited after it was applied — the change will NOT ` +
              `run on this database.`,
          );
        } else {
          fail(
            `${m.tag} has never run here and drizzle will SKIP it (older than ` +
              `the last applied migration). Re-create it as a new migration.`,
          );
        }
      }
    }

    const unknown = applied.filter(
      (r) => !migrations.some((m) => m.when === Number(r.created_at)),
    );
    if (unknown.length) {
      warn(
        `${unknown.length} migration(s) applied here are not in this branch — ` +
          `the database may be ahead of your code.`,
      );
    }

    ok(`${applied.length} applied`);
    if (pending.length === 0) {
      ok("up to date — db:migrate has nothing to do");
      return;
    }

    console.log(
      `\n${BOLD}  ${pending.length} pending — db:migrate will run:${OFF}`,
    );
    for (const m of pending) {
      console.log(`\n  ${BOLD}${m.tag}${OFF}`);
      console.log(indent(m.content.replaceAll("--> statement-breakpoint", "")));
      for (const why of riskyFindings(m.content)) warn(`${m.tag}: ${why}`);
    }
  } catch (error) {
    fail(`could not query the database: ${error.message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------- helpers --------------------------------- */

/** host/database only — never print the password. */
function describeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname} (user ${u.username})`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function indent(text) {
  return text
    .trim()
    .split("\n")
    .map((l) => `    ${DIM}${l}${OFF}`)
    .join("\n");
}

/* --------------------------------- run ----------------------------------- */

const migrations = checkFiles();
if (migrations) {
  checkSchemaDrift();
  await checkDatabase(migrations);
}

heading("Result");
if (errors) {
  console.log(
    `  ${RED}${errors} problem(s) — fix before running db:migrate.${OFF}`,
  );
  process.exit(1);
}
if (warnings) {
  console.log(
    `  ${YELLOW}OK with ${warnings} warning(s) — read them, then migrate.${OFF}`,
  );
} else {
  console.log(`  ${GREEN}All clear — safe to run db:migrate.${OFF}`);
}
