/** Per-device appearance. System follows prefers-color-scheme. Nothing is stored on the server. */

export const APPEARANCE_KEY = "joehub-appearance";

export function normalizeAppearance(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function appearanceIsDark(mode, systemDark) {
  const choice = normalizeAppearance(mode);
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return Boolean(systemDark);
}

export function readAppearance() {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return "system";
  }
}

export function applyAppearance(mode = readAppearance()) {
  const choice = normalizeAppearance(mode);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = appearanceIsDark(choice, systemDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.appearance = choice;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  return { choice, dark };
}

export function saveAppearance(mode) {
  const choice = normalizeAppearance(mode);
  localStorage.setItem(APPEARANCE_KEY, choice);
  const applied = applyAppearance(choice);
  window.dispatchEvent(new Event("joehub-appearance"));
  return applied;
}
