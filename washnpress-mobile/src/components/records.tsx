import { type ReactNode } from "react";
import { themed } from "./themed";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { font, theme, space, type,  radius, border, opacity, size } from "../theme";
import { density } from "../density";
import { pointer } from "./pointer";

// One card shape for every admin listing page.
//
// Each page had grown its own: a full-width block with the information spread
// across it, most of it empty, and an "Open" or "View details" button sitting next
// to the Edit button as though seeing a record and changing it were the same kind
// of act. Six of anything meant scrolling past six screens of whitespace, and
// nothing looked like anything else.
//
// The rule the whole portal now follows:
//
//   the card is the link — clicking anywhere on it opens the record;
//   the actions live inside it and never navigate;
//   the status is a badge, so it is readable without reading;
//   three across on a desktop, stepping down on a tablet and a phone.
//
// Actions are ordinary touchables that sit beside the card's own touchable, not
// inside it: react-native-web renders a Pressable with accessibilityRole="button"
// as a real <button>, and a <button> nested inside another <button> is invalid
// HTML — browsers silently restructure the DOM to recover, which is exactly the
// kind of thing that makes a click land on the wrong element. Keeping them as
// siblings (same visual position, since both still sit inside the outer card)
// sidesteps that on web while behaving identically on native, where Pressable
// press events never bubbled between them anyway.

export interface RecordField { label: string; value: ReactNode }

export function RecordCard({ title, badge, fields, actions, onOpen, footer }: {
  title: string;
  badge?: ReactNode;
  fields: RecordField[];
  actions?: ReactNode;
  onOpen?: () => void;
  footer?: ReactNode;
}) {
  const body = (
    <>
      <View style={styles.headRow}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {badge}
      </View>
      <View style={styles.fields}>
        {fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "").map((field) => (
          <View key={field.label} style={styles.fieldRow}>
            <Text style={styles.fieldLabel} numberOfLines={1}>{field.label}</Text>
            <View style={styles.fieldValue}>
              {typeof field.value === "string" || typeof field.value === "number"
                ? <Text style={styles.fieldText} numberOfLines={2}>{String(field.value)}</Text>
                : field.value}
            </View>
          </View>
        ))}
      </View>
      {footer}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </>
  );
  if (!onOpen) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable
      // `hovered` and `focused` are web-only facts — react-native-web fills them in
      // and a handset never does — so the same component gains a pointer affordance
      // in the staff build without the phone build changing at all.
      style={(state) => {
        const { pressed, hovered, focused } = pointer(state);
        return [styles.card, (hovered || focused) && styles.cardHover, pressed && styles.cardPressed];
      }}
      onPress={onOpen}
      // Not accessibilityRole="button": react-native-web maps that to a real
      // <button>, and the actions rendered inside (above) are themselves buttons
      // — a <button> nested inside a <button> is invalid HTML. The browser
      // "fixes" it by hoisting the inner button out of the outer one, which is
      // exactly the kind of DOM surgery that makes a click land somewhere other
      // than where it looks like it landed. A plain click target with no
      // explicit role reads a little less richly to a screen reader, but it
      // composes correctly with the buttons inside it, which a role="button"
      // card cannot.
    >
      {body}
    </Pressable>
  );
}

// A compact action inside a card. Deliberately not the full-width Button: a card
// with three full-width buttons stacked under it is a card that is mostly buttons.
export function CardAction({ label, onPress, tone = "default", disabled }: {
  label: string;
  onPress: () => void;
  tone?: "default" | "danger" | "good";
  disabled?: boolean;
}) {
  const colour = tone === "danger" ? theme.feedback.dangerText
    : tone === "good" ? theme.feedback.successText
    : theme.action.secondaryBorder;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        { borderColor: colour },
        pressed && !disabled && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[styles.actionText, { color: colour }]}>{label}</Text>
    </Pressable>
  );
}

// The edit form, drawn where the card was.
//
// Every page used to do this its own way: some expanded the card, some opened a
// modal, and the modal ones lost the reader's place on the list behind it. Editing
// one record is a change to that record, so it happens where the record is.
export function InlineEditCard({ title, children, onSave, onCancel, saving, saveDisabled, error }: {
  title: string;
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  // Save is not available because what is on the card is not valid yet, as opposed
  // to because it is already being saved. `saving` was the only way to stop the
  // button, and it relabels it "Saving…", which is a lie about what is happening.
  saveDisabled?: boolean;
  error?: string | null;
}) {
  return (
    <View style={[styles.card, styles.editing]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.editBody}>{children}</View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <CardAction label={saving ? "Saving…" : "Save"} onPress={onSave} tone="good" disabled={saving || saveDisabled} />
        <CardAction label="Cancel" onPress={onCancel} disabled={saving} />
      </View>
    </View>
  );
}

// A value that has nothing behind it. "—" reads as "does not apply here", which is
// a different thing from a blank space that reads as a bug.
export function Dash() {
  return <Text style={styles.dash}>—</Text>;
}

export function orDash(value: string | number | null | undefined): ReactNode {
  if (value === null || value === undefined || value === "") return <Dash />;
  return <Text style={styles.fieldText} numberOfLines={2}>{String(value)}</Text>;
}

const styles = themed((theme) => ({
  // A card under the pointer lifts its edge rather than its ground: tinting the whole
  // surface would fight the status badge sitting on it.
  cardHover: { borderColor: theme.brand.solid },
  card: {
    backgroundColor: theme.surface.card,
    borderRadius: radius.md,
    padding: density.card,
    marginBottom: density.snug,
    borderWidth: border.hairline,
    borderColor: theme.line.subtle,
  },
  cardPressed: { backgroundColor: theme.brand.tintFaint, borderColor: theme.brand.tint },
  editing: { borderColor: theme.brand.solid, borderWidth: border.focus, padding: space.card - 1 },
  editBody: { marginTop: space.snug },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.snug },
  title: { ...type.subheading, color: theme.text.primary, flex: 1, marginRight: space.snug },
  fields: { marginTop: 2 },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2 },
  fieldLabel: { ...type.caption, color: theme.text.tertiary, width: 108 },
  fieldValue: { flex: 1 },
  fieldText: { ...type.label, color: theme.text.primary },
  dash: { ...type.label, color: theme.text.tertiary },
  actions: { flexDirection: "row", flexWrap: "wrap", marginTop: space.base, marginHorizontal: -3 },
  action: {
    borderWidth: border.hairline,
    borderRadius: radius.sm,
    minHeight: size.control.sm,
    justifyContent: "center",
    paddingHorizontal: space.base,
    marginHorizontal: 3,
    marginTop: space.tight,
  },
  actionPressed: { backgroundColor: theme.brand.tintFaint },
  actionDisabled: { opacity: opacity.disabled },
  actionText: { ...type.caption, fontFamily: font.bold },
  error: { ...type.caption, color: theme.feedback.dangerText, marginTop: space.snug },
}));
