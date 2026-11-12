"use client";

import { useEffect, useState } from "react";
import { normalizeAppearance, readAppearance, saveAppearance } from "../lib/appearance.mjs";

const OPTIONS = ["light", "dark", "system"] as const;

const LABELS: Record<(typeof OPTIONS)[number], string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function AppearanceControl() {
  const [mode, setMode] = useState<(typeof OPTIONS)[number]>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => setMode(normalizeAppearance(readAppearance()));
    read();
    setReady(true);
    window.addEventListener("joehub-appearance", read);
    return () => window.removeEventListener("joehub-appearance", read);
  }, []);

  return (
    <div role="radiogroup" aria-label="Appearance" data-appearance={mode} data-hydrated={ready ? "true" : "false"} className="flex rounded-full border border-line p-0.5">
      {OPTIONS.map((option) => {
        const on = mode === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            data-appearance-option={option}
            className={`min-h-11 min-w-11 flex-1 rounded-full text-meta font-medium ${on ? "bg-ink text-page" : "text-muted"}`}
            onClick={() => {
              setMode(option);
              saveAppearance(option);
            }}
          >
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
