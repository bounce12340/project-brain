export type FontSizePreference = "standard" | "large";

const STORAGE_KEY = "font-size-preference";

export function readFontSizePreference(): FontSizePreference {
  return localStorage.getItem(STORAGE_KEY) === "large" ? "large" : "standard";
}

export function applyFontSizePreference(value: FontSizePreference): void {
  document.documentElement.dataset.fontsize = value;
  localStorage.setItem(STORAGE_KEY, value);
}
