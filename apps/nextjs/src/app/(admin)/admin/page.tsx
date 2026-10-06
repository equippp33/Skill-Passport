import { Icon } from "~/components/ui/icon";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, buttonClasses } from "~/components/ui";
import { getAdminStats, requireAdmin } from "~/server/admin/service";
import { CreateInterview } from "./create-interview";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: "mic" | "people" | "check" | "report";
}) {
  return (
    <Card className="transition-colors hover:border-border-strong">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-content-muted">{label}</p>
          <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent min-[420px]:grid">
            <Icon name={icon} />
          </span>
        </div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-content-muted">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const admin = await requireAdmin("/admin");
  const stats = await getAdminStats(admin.id);

  return (
    <>
      <div className="page-heading flex flex-wrap items-end justify-between gap-4 mt-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-xs text-content-muted">
            Understand workplace skills through AI-powered interviews.
          </p>
        </div>
        <Link
          href="/admin/interviews"
          className={buttonClasses("secondary", "md")}
        >
          All interviews
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat
          icon="mic"
          label="Interviews"
          value={stats.interviews}
          hint={`${stats.openInterviews} open`}
        />
        <Stat icon="people" label="Candidates" value={stats.attempts} />
        <Stat
          icon="check"
          label="Completed"
          value={stats.completed}
          hint={
            stats.inProgress > 0 ? `${stats.inProgress} in progress` : undefined
          }
        />
        <Stat
          icon="report"
          label="Average score"
          value={
            stats.averageScore === null
              ? "—"
              : `${(stats.averageScore / 10).toFixed(1)}/10`
          }
        />
      </div>

      <Card className="border-accent/15 bg-linear-to-br from-surface to-accent-soft">
        <CardContent className="p-4 sm:p-5">
          <CreateInterview />
        </CardContent>
      </Card>
    </>
  );
}
