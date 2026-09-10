import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAttemptForAdmin, requireAdmin } from "~/server/admin/service";
import { appUrl } from "~/server/app-url";
import { lucia } from "~/server/auth/lucia";
import { PdfUnavailableError, renderPageToPdf } from "~/server/pdf";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Chromium start-up plus a multi-page render. */
export const maxDuration = 60;

/**
 * The candidate's report as a downloaded PDF.
 *
 * Renders the report page itself through headless Chromium rather than
 * rebuilding the layout for print — so the file cannot drift from what the
 * admin was just looking at, and the Indic scripts in it shape correctly.
 * See `~/server/pdf` for why a JavaScript PDF library will not do.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const admin = await requireAdmin("/admin");

  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Scoped to this admin, exactly as the page is. Checked here rather than
  // relying on the render, so an id from someone else's interview is a 404
  // and not a browser launch.
  const found = await getAttemptForAdmin(admin.id, parsed.data);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(lucia.sessionCookieName)?.value;
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const origin = await appUrl();
  const { hostname } = new URL(origin);

  try {
    const pdf = await renderPageToPdf({
      url: `${origin}/admin/attempts/${found.attempt.id}`,
      // The page is behind auth; the browser fetches it as this admin.
      cookies: [
        { name: lucia.sessionCookieName, value: session, domain: hostname },
      ],
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        // `attachment` is what makes it a download rather than a tab.
        "Content-Disposition": `attachment; filename="${fileName(
          found.attempt.candidateName,
          found.interview.title,
        )}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PdfUnavailableError) {
      console.error("[admin] PDF export: no Chromium available");
      return NextResponse.json(
        {
          error:
            "PDF export is not available on this server: no Chromium was found.",
        },
        { status: 501 },
      );
    }
    console.error("[admin] PDF export failed", error);
    return NextResponse.json(
      { error: "The report could not be exported." },
      { status: 500 },
    );
  }
}

/**
 * A filename someone can find later.
 *
 * Anything outside a conservative set is replaced: a candidate's name is
 * free text, and it ends up in a `Content-Disposition` header and then on a
 * filesystem, neither of which should be handed arbitrary characters.
 */
function fileName(candidate: string, interview: string): string {
  const slug = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "report";

  const date = new Date().toISOString().slice(0, 10);
  return `${slug(candidate)}-${slug(interview)}-${date}.pdf`;
}
