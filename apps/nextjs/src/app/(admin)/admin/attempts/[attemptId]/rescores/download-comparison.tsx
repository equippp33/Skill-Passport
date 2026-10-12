"use client";

import { useState } from "react";

import { Alert, Button } from "~/components/ui";

/**
 * Save the comparison as a PDF. DEVELOPMENT ONLY.
 *
 * The route renders THIS page through headless Chromium rather than building
 * a second layout for print, so the file is the screen. Elements marked
 * `data-print-hide` (the back link, this button) drop out, and nothing else
 * can drift between the two.
 *
 * Fetch-and-save rather than a link, matching `DownloadReport`: the render
 * can fail — no Chromium, a timeout — and a link would navigate the admin to
 * a JSON error page instead of saying so here.
 *
 * The chosen versions ride along in the URL. The export drives a browser at
 * the comparison page, which cannot see client state, so without them the
 * file would quietly show every version regardless of what was on screen.
 */
export function DownloadComparison({
  attemptId,
  versions,
}: {
  attemptId: string;
  /** Which versions are on screen. The PDF is rendered showing these. */
  versions: number[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/attempts/${attemptId}/rescores/pdf?v=${versions.join(",")}`,
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "The comparison could not be exported.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(response) ?? "score-history.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      // Freed on the next tick; revoking immediately can cancel the save
      // in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("The comparison could not be exported.");
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
        {busy ? "Preparing…" : "Download comparison"}
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
