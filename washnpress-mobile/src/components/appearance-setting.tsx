import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  APPEARANCE_CHOICES, APPEARANCE_LABELS,
  appearanceChoice, setAppearance, onAppearanceChange, type Appearance,
} from "../appearance";
import { theme, space, radius, border } from "../theme";
import { themed } from "./themed";
import { pointer } from "./pointer";

// The theme control, small enough to sit in a header.
//
// Two icons — a sun for light and a moon for dark — so switching is one tap and the
// active mode is shown by which icon is lit. "Follow the system" and the larger
// text-button section it lived in are gone: the app opens light by default and the
// person chooses light or dark themselves. The state is shared through the appearance
// store, so every place this appears agrees at once and the switch takes effect with
// no reload.
const APPEARANCE_GLYPH: Record<Appearance, string> = { light: "🌞", dark: "🌙" };

export function AppearanceIcons() {
  const [choice, setChoice] = useState<Appearance>(appearanceChoice());
  useEffect(() => {
    setChoice(appearanceChoice());
    return onAppearanceChange(setChoice);
  }, []);
  return (
    <View style={styles.iconRow} accessibilityRole="radiogroup" accessibilityLabel="Theme">
      {APPEARANCE_CHOICES.map((option) => {
        const selected = option === choice;
        return (
          <Pressable
            key={option}
            onPress={() => setAppearance(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${APPEARANCE_LABELS[option]} mode`}
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

const styles = themed((theme) => ({
  iconRow: { flexDirection: "row", gap: space.snug },
  iconOption: {
    width: 40, height: 36, alignItems: "center", justifyContent: "center",
    borderRadius: radius.sm, borderWidth: border.hairline,
    borderColor: theme.line.strong, backgroundColor: theme.surface.card,
  },
  iconGlyph: { fontSize: 18, lineHeight: 22 },
  optionHovered: { borderColor: theme.brand.solid },
  optionPressed: { backgroundColor: theme.surface.sunken },
  optionSelected: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
}));
