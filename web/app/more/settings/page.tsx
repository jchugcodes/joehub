"use client";

import { useRouter } from "next/navigation";
import { AppearanceControl } from "../../../components/AppearanceControl";
import { Icon } from "../../../components/Icon";
import { settingsBack } from "../../../lib/settings-back.mjs";

export default function SettingsPage() {
  const router = useRouter();
  return (
    <div data-ready="true" className="finance-type min-w-0">
      <header className="pt-3">
        <p className="px-5 text-meta text-muted">joehub</p>
        <div className="flex items-center pl-2 pr-5">
          <button
            type="button"
            aria-label="Back"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center"
            onClick={() => {
              const target = settingsBack(document.referrer, window.history.length, window.location.origin);
              if (target === "back") router.back();
              else router.push(target);
            }}
          >
            <Icon name="back" size={20} />
          </button>
          <h1 className="text-title font-medium">Settings</h1>
        </div>
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
