import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari } from "next/font/google";

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
    applicationName: "Skill Passport",
    icons: { icon: "/icon.svg" },
  };
}

/**
 * Self-hosted at build time by next/font, so there is no render-blocking
 * request to Google and no layout shift when it loads.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#4338ca",
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
    <html
      lang={lang.code}
      className={`${inter.variable} ${devanagari.variable}`}
    >
      <body className="min-h-screen bg-canvas text-content antialiased">
        {children}
      </body>
    </html>
  );
}
