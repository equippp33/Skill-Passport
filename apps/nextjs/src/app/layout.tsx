import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { uiLanguage, uiMessages } from "~/server/language";

import "./globals.css";

/**
 * Metadata is generated rather than static so the document title and language
 * follow INTERVIEW_LANGUAGE like everything else.
 */
export async function generateMetadata(): Promise<Metadata> {
  const m = uiMessages();
  return {
    title: {
      default: `${m.app.name} — ${m.app.tagline}`,
      template: `%s · ${m.app.name}`,
    },
    description: m.dashboard.subtitle,
  };
}

/**
 * Self-hosted at build time by next/font, so there is no render-blocking
 * request to Google and no layout shift when it loads.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // `lang` matters for screen-reader pronunciation and font selection of
  // Devanagari and other Indic scripts.
  const lang = uiLanguage();

  return (
    <html lang={lang.code} className={inter.variable}>
      <body className="min-h-screen bg-canvas text-content antialiased">
        {children}
      </body>
    </html>
  );
}
