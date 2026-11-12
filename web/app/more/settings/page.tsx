"use client";

import { AppearanceControl } from "../../../components/AppearanceControl";

export default function SettingsPage() {
  return (
    <div data-ready="true" className="finance-type min-w-0">
      <header className="px-5 pt-3">
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Settings</h1>
      </header>
      <section className="px-5 pt-6" aria-labelledby="appearance-label">
        <h2 id="appearance-label" className="text-section font-medium">
          Appearance
        </h2>
        <div className="mt-3">
          <AppearanceControl />
        </div>
      </section>
    </div>
  );
}
