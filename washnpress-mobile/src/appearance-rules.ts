// What a person can ask for, and what that resolves to.
//
// Two settings: light and dark, chosen with a tap on the matching icon. "Follow the
// system" was removed — the app opens in light by default and the person switches it
// themselves, so there is one clear active state rather than a mode that silently
// tracks the device. Light is the default because it is the mode the product was
// designed in first and the right one for somebody who has never touched the toggle.

export const APPEARANCE_CHOICES = ["light", "dark"] as const;
export type Appearance = (typeof APPEARANCE_CHOICES)[number];

export type Scheme = "light" | "dark";

// The default the app opens in before anyone has chosen, and the value any older
// stored "system" preference now falls back to.
export const DEFAULT_APPEARANCE: Appearance = "light";

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCE_CHOICES as readonly string[]).includes(value);
}

// The mode to actually render in. A choice is now always a concrete scheme, so this
// is the choice itself; the `system` parameter is kept for callers that still pass
// the device scheme, and ignored.
export function resolveScheme(choice: Appearance, _system?: Scheme | null): Scheme {
  return choice === "dark" ? "dark" : "light";
}

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  light: "Light",
  dark: "Dark",
};
