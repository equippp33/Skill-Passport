import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui";
import { t } from "~/config/messages";
import type { Messages } from "~/config/messages";
import { INTERVIEW_LANGUAGES } from "~/config/languages";
import type { InterviewLanguageKey } from "~/config/languages";
import type { WorkSkillId } from "~/config/work-skills";
import type { InterviewAttempt, InterviewTurn } from "~/server/db/schema";
import { aggregateSkillScores } from "~/server/attempt/service";
import { formatDate } from "~/lib/utils";

/**
 * The interview report.
 *
 * Shared by the candidate's own result page and the admin review, so the two
 * can never drift. `showCandidate` adds the identifying details an admin
 * needs and a candidate has no reason to be shown back to themselves.
 *
 * Labels are UI language; everything the model wrote and everything the
 * candidate said stays in the interview language, marked with `lang` so
 * screen readers and font fallback behave.
 */
export function AttemptReport({
  attempt,
  turns,
  m,
  showCandidate = false,
}: {
  attempt: InterviewAttempt;
  turns: InterviewTurn[];
  m: Messages;
  showCandidate?: boolean;
}) {
  const language = attempt.language
    ? INTERVIEW_LANGUAGES[attempt.language as InterviewLanguageKey]
    : null;
  const langCode = language?.code;

  const answered = turns.filter(
    (x) => x.kind === "skill" && x.status === "completed",
  );
  const skillScores = aggregateSkillScores(turns);
  const probe = turns.find((x) => x.kind === "language_probe");

  return (
    <div className="space-y-6">
      {showCandidate ? (
        <Card>
          <CardContent className="grid gap-x-6 gap-y-2 pt-6 sm:grid-cols-2">
            <Detail label="Candidate" value={attempt.candidateName} />
            <Detail label="Email" value={attempt.candidateEmail ?? "—"} />
            <Detail label="Phone" value={attempt.candidatePhone ?? "—"} />
            <Detail
              label="Language"
              value={
                language ? `${language.displayName} (${language.code})` : "—"
              }
            />
            <Detail
              label="Left the tab"
              value={
                attempt.awayCount > 0 ? `${attempt.awayCount} times` : "no"
              }
            />
            <Detail label="Completed" value={formatDate(attempt.completedAt)} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-6 pt-6">
          <div>
            <p className="text-sm text-content-muted">
              {m.result.overallScore}
            </p>
            <p className="text-4xl font-semibold tabular-nums">
              {attempt.overallScore ?? "—"}
              {attempt.overallScore !== null ? (
                <span className="text-lg text-content-muted">/100</span>
              ) : null}
            </p>
          </div>
          <div className="text-sm text-content-muted">
            {t(m.result.answered, {
              answered: answered.length,
              total: skillScores.length,
            })}
          </div>
        </CardContent>
      </Card>

      {/* All ten skills, always — unassessed ones are shown, not hidden. */}
      <Card>
        <CardHeader>
          <CardTitle>{m.result.skillBreakdown}</CardTitle>
          <p className="mt-1 text-sm text-content-muted">
            {m.result.skillBreakdownHint}
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border-subtle">
            {skillScores.map((s) => (
              <SkillRow
                key={s.skillId}
                label={m.skills[s.skillId]}
                score={s.score}
                notAssessed={m.result.notAssessed}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      {attempt.summary ? (
        <Card>
          <CardHeader>
            <CardTitle>{m.result.summary}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed" lang={langCode}>
              {attempt.summary}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <ListCard
          title={m.result.strengths}
          items={attempt.strengths}
          empty={m.result.noStrengths}
          marker="✓"
          markerClass="text-success"
          lang={langCode}
        />
        <ListCard
          title={m.result.improvements}
          items={attempt.improvements}
          empty={m.result.noImprovements}
          marker="→"
          markerClass="text-warning"
          lang={langCode}
        />
      </div>

      {showCandidate && probe?.answerTranscript ? (
        <Card>
          <CardHeader>
            <CardTitle>Opening answer (language sample)</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              lang={probe.detectedLanguageCode ?? langCode}
            >
              {probe.answerTranscript}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          {m.result.questionBreakdown}
        </h2>

        {answered.length === 0 ? (
          <Alert tone="warning">{m.result.noAnswers}</Alert>
        ) : (
          answered.map((turn) => (
            <Card key={turn.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium text-content-muted">
                    {turn.skillId
                      ? m.skills[turn.skillId as WorkSkillId]
                      : `Question ${turn.turnNumber}`}
                  </CardTitle>
                  <span
                    className={`text-sm font-semibold tabular-nums ${scoreTone(
                      turn.score,
                    )}`}
                  >
                    {turn.score === null ? "—" : `${turn.score}/10`}
                  </span>
                </div>
                <p className="mt-1 text-base font-medium" lang={langCode}>
                  {turn.question}
                </p>
                {turn.questionTranslation ? (
                  <p className="mt-1 text-sm text-content-muted" lang="en">
                    {turn.questionTranslation}
                  </p>
                ) : null}
              </CardHeader>

              <CardContent className="space-y-4">
                {turn.answerVideoId ? (
                  <video
                    controls
                    playsInline
                    preload="none"
                    src={`/api/media/${turn.answerVideoId}${
                      showCandidate ? "" : `?attempt=${attempt.id}`
                    }`}
                    aria-label={m.result.yourAnswer}
                    className="aspect-video w-full rounded-lg border border-border-subtle bg-content/90"
                  />
                ) : null}

                <div>
                  <p className="text-xs font-medium text-content-muted">
                    {m.result.yourAnswer}
                  </p>
                  {/* Original transcript, never translated. */}
                  <p
                    className="mt-1 text-sm leading-relaxed whitespace-pre-wrap"
                    lang={turn.detectedLanguageCode ?? langCode}
                  >
                    {turn.answerTranscript ?? "—"}
                  </p>
                </div>

                {turn.evaluation ? (
                  <div className="rounded-md bg-surface-muted px-3 py-2.5">
                    <p className="text-xs font-medium text-content-muted">
                      {m.result.evaluation}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed" lang={langCode}>
                      {turn.evaluation}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-content-muted">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function scoreTone(score: number | null): string {
  if (score === null) return "text-content-muted";
  if (score >= 7) return "text-success";
  if (score >= 4) return "text-warning";
  return "text-danger";
}

function SkillRow({
  label,
  score,
  notAssessed,
}: {
  label: string;
  score: number | null;
  notAssessed: string;
}) {
  const pct = score === null ? 0 : (score / 10) * 100;
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <div
        className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted sm:block"
        role="presentation"
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`w-20 shrink-0 text-right text-sm font-semibold tabular-nums ${scoreTone(
          score,
        )}`}
      >
        {score === null ? (
          <span className="text-xs font-normal">{notAssessed}</span>
        ) : (
          <>
            {score}
            <span className="text-content-muted">/10</span>
          </>
        )}
      </span>
    </li>
  );
}

function ListCard({
  title,
  items,
  empty,
  marker,
  markerClass,
  lang,
}: {
  title: string;
  items: string[] | null;
  empty: string;
  marker: string;
  markerClass: string;
  lang?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items && items.length > 0 ? (
          <ul className="space-y-2 text-sm" lang={lang}>
            {items.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className={markerClass}>
                  {marker}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-content-muted">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}
