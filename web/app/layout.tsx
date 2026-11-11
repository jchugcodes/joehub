import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { AppShell } from "../components/AppShell";
import { LivePagesProvider } from "../components/LivePages";
import { productionNav } from "../lib/live-pages.mjs";
import "./globals.css";

/** Same bytes as sources/fonts/DM-Sans-variable.ttf (SHA-256 8cd08d97…). next/font/local serves that file. */
const dmSans = localFont({
  src: "../fonts/DM-Sans-variable.ttf",
  variable: "--font-dm",
  weight: "100 1000",
  display: "block",
  adjustFontFallback: false,
});

/** Tasks, the Home tasks card, Grocery, and Finance use Outfit. Jobs, Journal, More, and the rest of Home stay on DM Sans. */
const outfit = localFont({
  src: "../fonts/Outfit-variable.ttf",
  variable: "--font-outfit",
  weight: "100 900",
  display: "block",
  adjustFontFallback: false,
  declarations: [{ prop: "font-optical-sizing", value: "none" }],
});

export const metadata: Metadata = { title: "joehub" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${outfit.variable}`}>
      <body className="font-sans">
        <Suspense fallback={<main className="p-4">Loading joehub</main>}>
          <LivePagesProvider production={productionNav()}>
            <AppShell>{children}</AppShell>
          </LivePagesProvider>
        </Suspense>
      </body>
    </html>
  );
}
