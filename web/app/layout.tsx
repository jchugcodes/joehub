import type { Metadata } from "next";

export const metadata: Metadata = { title: "joehub" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* TODO: design handoff — navigation and page chrome */}
        <header>
          <p>joehub</p>
          <nav>
            <a href="/finance">Finance</a> <a href="/jobs">Jobs</a> <a href="/journal">Journal</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
