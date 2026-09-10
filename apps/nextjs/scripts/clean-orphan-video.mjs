/**
 * One-off cleanup: remove reserved answer_video rows that never received an
 * upload (size 0 and not linked to any turn). These are left behind when the
 * browser's direct PUT to R2 fails, which happened for every video until the
 * relay fallback landed.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const orphans = await sql`
  SELECT a.id, a.storage_key
  FROM interview_audio a
  WHERE a.kind = 'answer_video'
    AND a.size_bytes = 0
    AND NOT EXISTS (
      SELECT 1 FROM interview_turns t WHERE t.answer_video_id = a.id
    )
`;

if (orphans.length === 0) {
  console.log("No orphaned answer_video rows.");
} else {
  for (const row of orphans) console.log("removing", row.id, row.storage_key);
  await sql`
    DELETE FROM interview_audio
    WHERE id IN ${sql(orphans.map((r) => r.id))}
  `;
  console.log(`Removed ${orphans.length} row(s).`);
}

await sql.end();
