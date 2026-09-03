import { useEffect, useState } from "react";
import { View, Text, Pressable, useColorScheme } from "react-native";
import {
  APPEARANCE_CHOICES, APPEARANCE_LABELS, appearanceHint,
  appearanceChoice, setAppearance, onAppearanceChange, type Appearance,
} from "../appearance";
import { theme, space, type, radius, border, size } from "../theme";
import { themed } from "./themed";
import { pointer } from "./pointer";

// The same setting, compact enough to sit in a header rather than fill a section.
//
// Three small controls — sun, moon, and follow-the-system — so quick light/dark
// switching is one tap and "Follow the system" is still reachable rather than being
// the casualty of making the thing smaller. It shares its state with the full
// control above through the same store, so the two never disagree.
const APPEARANCE_GLYPH: Record<Appearance, string> = { light: "🌞", dark: "🌙", system: "🖥️" };

export function AppearanceIcons() {
  const [choice, setChoice] = useState<Appearance>(appearanceChoice());
  useEffect(() => {
    setChoice(appearanceChoice());
    return onAppearanceChange(setChoice);
  }, []);
  return (
    <View style={styles.iconRow} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
      {APPEARANCE_CHOICES.map((option) => {
        const selected = option === choice;
        return (
          <Pressable
            key={option}
            onPress={() => setAppearance(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={APPEARANCE_LABELS[option]}
            style={(state) => {
              const { pressed, hovered, focused } = pointer(state);
              return [
                styles.iconOption,
                selected && styles.optionSelected,
                !selected && (hovered || focused) && styles.optionHovered,
                pressed && styles.optionPressed,
              ];
            }}
          >
            <Text style={styles.iconGlyph}>{APPEARANCE_GLYPH[option]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The appearance control, in every profile screen.
//
// Three buttons rather than a switch. "Dark mode: on/off" cannot express "follow my
// device", so the first person to touch it is pinned to whichever way they left it —
// and the way back is not discoverable, because the setting no longer has a name for
// it. Three is one more control and one fewer trap.
//
// One component for all four portals. A resident and an admin want exactly the same
// thing here, and four copies is four places for the wording to drift.
export function AppearanceSetting() {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [choice, setChoice] = useState<Appearance>(appearanceChoice());

  // The stored value is read once at startup, which may land after this mounts.
  useEffect(() => { setChoice(appearanceChoice()); }, []);

  const pick = (next: Appearance) => {
    setChoice(next);
    setAppearance(next);
  };

  return (
    <View>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {APPEARANCE_CHOICES.map((option) => {
          const selected = option === choice;
          return (
            <Pressable
              key={option}
              onPress={() => pick(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={APPEARANCE_LABELS[option]}
              style={(state) => {
                const { pressed, hovered, focused } = pointer(state);
                return [
                  styles.option,
                  selected && styles.optionSelected,
                  !selected && (hovered || focused) && styles.optionHovered,
                  pressed && styles.optionPressed,
                ];
              }}
            >
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} numberOfLines={1}>
                {APPEARANCE_LABELS[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* Somebody following the system cannot otherwise tell which way it has gone,
          and "Follow the system" alone reads as a setting that did nothing. */}
      <Text style={styles.hint}>{appearanceHint(choice, system)}</Text>
    </View>
  );
}

const styles = themed((theme) => ({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.snug },
  iconRow: { flexDirection: "row", gap: space.snug },
  iconOption: {
    width: 40, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: radius.sm, borderWidth: border.hairline,
    borderColor: theme.line.strong, backgroundColor: theme.surface.card,
  },
  iconGlyph: { fontSize: 18, lineHeight: 22 },
  option: {
    minHeight: size.touch,
    justifyContent: "center",
    paddingHorizontal: space.page,
    borderRadius: radius.sm,
    borderWidth: border.hairline,
    borderColor: theme.line.strong,
    backgroundColor: theme.surface.card,
  },
  optionHovered: { borderColor: theme.brand.solid },
  optionPressed: { backgroundColor: theme.surface.sunken },
  optionSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
  optionLabel: { ...type.label, color: theme.text.secondary },
  optionLabelSelected: { color: theme.text.onAction },
  hint: { ...type.caption, color: theme.text.tertiary, marginTop: space.snug },
}));
