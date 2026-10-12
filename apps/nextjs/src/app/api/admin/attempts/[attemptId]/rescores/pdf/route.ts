import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getScoreHistory, requireAdmin } from "~/server/admin/service";
import { selfOrigin } from "~/server/app-url";
import { lucia } from "~/server/auth/lucia";
import { PdfUnavailableError, renderPageToPdf } from "~/server/pdf";
import { uuidSchema } from "~/server/interview/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Chromium start-up plus a multi-page render. */
export const maxDuration = 60;

/**
 * The score-history comparison as a downloaded PDF. DEVELOPMENT ONLY.
 *
 * Renders the comparison page itself through headless Chromium, exactly as
 * the report export does, so the file cannot drift from what was on screen.
 * `getScoreHistory` is the authorization: it returns null outside development
 * and for an attempt belonging to another admin.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const admin = await requireAdmin("/admin");

  const { attemptId: raw } = await ctx.params;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Checked here rather than relying on the render, so an id from somewhere
  // else is a 404 and not a browser launch.
  const history = await getScoreHistory(admin.id, parsed.data);
  if (!history) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(lucia.sessionCookieName)?.value;
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // This server, not the public domain: the browser is being sent back into
  // the app it is already running in. See `selfOrigin`.
  const origin = await selfOrigin();
  const { hostname } = new URL(origin);

  // Passed straight through to the page, which validates it against the
  // versions this attempt actually has. Kept opaque here: this route only
  // forwards the choice, it does not interpret it.
  const chosen = new URL(request.url).searchParams.get("v");
  const query = chosen ? `?v=${encodeURIComponent(chosen)}` : "";

  try {
    const pdf = await renderPageToPdf({
      url: `${origin}/admin/attempts/${history.attemptId}/rescores${query}`,
      cookies: [
        { name: lucia.sessionCookieName, value: session, domain: hostname },
      ],
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName(
          history.candidateName,
        )}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PdfUnavailableError) {
      console.error("[admin] score-history PDF: no Chromium available");
      return NextResponse.json(
        {
          error:
            "PDF export is not available on this server: no Chromium was found.",
        },
        { status: 501 },
      );
    }
    console.error("[admin] score-history PDF failed", error);
    return NextResponse.json(
      { error: "The comparison could not be exported." },
      { status: 500 },
    );
  }
}

/**
 * A filename someone can find later.
 *
 * Anything outside a conservative set is replaced: a name is free text, and
 * it ends up in a `Content-Disposition` header and then on a filesystem,
 * neither of which should be handed arbitrary characters.
 */
function fileName(candidate: string): string {
  const slug =
    candidate
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "candidate";

  return `${slug}-score-history-${new Date().toISOString().slice(0, 10)}.pdf`;
}
