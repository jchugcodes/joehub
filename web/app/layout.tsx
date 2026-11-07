import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Sans } from "next/font/google";
import { AppShell } from "../components/AppShell";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
  display: "swap",
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
