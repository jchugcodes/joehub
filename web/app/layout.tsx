import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { AppShell } from "../components/AppShell";
import "./globals.css";

/** Same bytes as sources/fonts/DM-Sans-variable.ttf (SHA-256 8cd08d97…). next/font/local serves that file. */
const dmSans = localFont({
  src: "../fonts/DM-Sans-variable.ttf",
  variable: "--font-dm",
  weight: "100 1000",
  display: "block",
  adjustFontFallback: false,
});

export const metadata: Metadata = { title: "joehub" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="font-sans">
        <Suspense fallback={<main className="p-4">Loading joehub</main>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
