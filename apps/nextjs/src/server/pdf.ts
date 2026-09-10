import "server-only";

import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";

/**
 * Rendering a page of the app to PDF.
 *
 * Uses a headless Chromium rather than a JavaScript PDF library, and the
 * reason is the content: these reports carry Devanagari, Telugu and Tamil.
 * Those scripts need real text shaping — conjuncts, reordered vowel signs,
 * ligatures — and `pdf-lib`, `pdfkit` and `@react-pdf/renderer` all map code
 * points straight to glyphs with no shaping at all. They would produce text
 * that looks plausible and is wrong, which is worse than failing.
 *
 * Chromium already has HarfBuzz and the fonts, so it renders exactly what
 * the browser shows, keeps the text selectable, and preserves links.
 *
 * The trade is an executable to install. It is NOT bundled — `puppeteer-core`
 * ships no browser — so the container installs the system Chromium and points
 * `CHROMIUM_PATH` at it.
 */

/**
 * Where the browser is.
 *
 * `CHROMIUM_PATH` wins so a container can be explicit. The fallbacks are
 * only for developer machines, where whatever is installed will do.
 */
function findChromium(): string | null {
  const configured = process.env.CHROMIUM_PATH;
  if (configured) return existsSync(configured) ? configured : null;

  const candidates = [
    // Linux / Alpine, as installed by the Dockerfile.
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((path) => existsSync(path)) ?? null;
}

export class PdfUnavailableError extends Error {
  constructor() {
    super("No Chromium executable found for PDF rendering");
    this.name = "PdfUnavailableError";
  }
}

/**
 * Render one URL of this app to a PDF.
 *
 * The session cookie is handed to the browser so it fetches the page as the
 * signed-in admin — the report is behind auth, and rendering it any other
 * way would mean a second, unauthenticated path to the same data.
 */
export async function renderPageToPdf(input: {
  url: string;
  cookies: { name: string; value: string; domain: string }[];
}): Promise<Buffer> {
  const executablePath = findChromium();
  if (!executablePath) throw new PdfUnavailableError();

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      // `--no-sandbox` is required to run as a non-root user in a container
      // without extra kernel capabilities. Safe here: the only page this
      // browser ever opens is our own, and it is closed immediately.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    if (input.cookies.length > 0) await browser.setCookie(...input.cookies);

    // `networkidle0` would wait for the video elements to finish loading,
    // which they never do with `preload="none"`. The report is server
    // rendered, so the DOM is complete at `domcontentloaded`; the extra
    // wait is for fonts, which decide whether Indic text shapes at all.
    await page.goto(input.url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.evaluateHandle("document.fonts.ready");

    // Print rules, not screen rules: the same stylesheet that hides the
    // sidebar and turns the recordings into links.
    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#666;padding:0 12mm;' +
        'display:flex;justify-content:space-between;">' +
        "<span>Skill Passport</span>" +
        '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
        "</div>",
    });

    return Buffer.from(pdf);
  } finally {
    await browser?.close();
  }
}
