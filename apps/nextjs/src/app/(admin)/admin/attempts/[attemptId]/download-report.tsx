"use client";

import { useState } from "react";

import { Alert, Button } from "~/components/ui";

/**
 * Download the report as a PDF.
 *
 * A plain fetch-and-save rather than an `<a download>`: the server can fail
 * (no Chromium installed, a render timeout) and a link would navigate the
 * admin to a JSON error page instead of telling them here. Fetching lets
 * the button own its own pending and error state.
 *
 * The file is produced server-side by headless Chromium — see
 * `~/server/pdf` for why, in one line: the reports contain Indic scripts
 * that JavaScript PDF libraries cannot shape correctly.
 */
export function DownloadReport({ attemptId }: { attemptId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/attempts/${attemptId}/pdf`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "The report could not be exported.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response) ?? "report.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      // Freed on the next tick; revoking immediately can cancel the save
      // in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("The report could not be exported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <Alert tone="danger" className="py-1.5 text-xs">
          {error}
        </Alert>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Preparing…" : "Download PDF"}
      </Button>
    </div>
  );
}

/** Use the name the server chose, so the file is findable later. */
function fileNameFrom(response: Response): string | null {
  const header = response.headers.get("content-disposition");
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? null;
}
