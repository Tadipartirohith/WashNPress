// What a person can ask for, and what that resolves to.
//
// Three settings, not two. A switch labelled "Dark mode" has only on and off, and
// choosing either takes the app off the system setting permanently — so somebody who
// looks once at nine in the morning is stuck in light at eleven at night, and there
// is no way back short of reinstalling. "Follow the system" has to be a value the
// person can return to, which means it has to be one of the choices.
//
// It is also the default, because it is the only one that is right for somebody who
// has never opened this screen.

export const APPEARANCE_CHOICES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCE_CHOICES)[number];

export type Scheme = "light" | "dark";

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCE_CHOICES as readonly string[]).includes(value);
}

// The mode to actually render in.
//
// `system` is null on the web until the browser reports one, and on a device that has
// never been told. Light is the answer then: it is the mode the product was designed
// in first and the safer one to be wrong about in daylight.
export function resolveScheme(choice: Appearance, system: Scheme | null | undefined): Scheme {
  if (choice === "light" || choice === "dark") return choice;
  return system === "dark" ? "dark" : "light";
}

export const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: "Follow the system",
  light: "Light",
  dark: "Dark",
};

// What the setting is doing right now, for the line under the control.
//
// A person who has chosen "Follow the system" cannot otherwise tell which way it has
// currently gone, and "Follow the system" alone reads as a setting that has not taken
// effect.
export function appearanceHint(choice: Appearance, system: Scheme | null | undefined): string {
  if (choice === "system") {
    return `Your device is set to ${resolveScheme("system", system)} at the moment.`;
  }
  return "Set here, whatever your device is using.";
}
