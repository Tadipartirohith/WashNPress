import { type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { theme, space } from "../theme";

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
// Actions are ordinary touchables nested inside the card's own. React Native does
// not bubble a press from an inner touchable to an outer one, so pressing Edit
// edits and does not also navigate — which is the single most annoying way a card
// like this goes wrong.

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
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onOpen}>
      {body}
    </TouchableOpacity>
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
  const colour = tone === "danger" ? theme.danger : tone === "good" ? theme.success : theme.deepTeal;
  return (
    <TouchableOpacity
      style={[styles.action, { borderColor: colour }, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
    >
      <Text style={[styles.actionText, { color: colour }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// The edit form, drawn where the card was.
//
// Every page used to do this its own way: some expanded the card, some opened a
// modal, and the modal ones lost the reader's place on the list behind it. Editing
// one record is a change to that record, so it happens where the record is.
export function InlineEditCard({ title, children, onSave, onCancel, saving, error }: {
  title: string;
  children: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
}) {
  return (
    <View style={[styles.card, styles.editing]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.editBody}>{children}</View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <CardAction label={saving ? "Saving…" : "Save"} onPress={onSave} tone="good" disabled={saving} />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.white, borderRadius: 12, padding: space.base,
    marginBottom: space.snug, borderWidth: 1, borderColor: theme.border,
  },
  editing: { borderColor: theme.aqua, borderWidth: 2 },
  editBody: { marginTop: space.snug },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  title: { fontSize: 15, fontWeight: "700", color: theme.deepTeal, flex: 1, marginRight: 8 },
  fields: { marginTop: 2 },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2 },
  fieldLabel: { fontSize: 12, color: theme.muted, width: 108 },
  fieldValue: { flex: 1 },
  fieldText: { fontSize: 13, color: theme.slate },
  dash: { fontSize: 13, color: theme.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", marginTop: space.snug, marginHorizontal: -3 },
  action: {
    borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10,
    marginHorizontal: 3, marginTop: 4,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { fontSize: 12, fontWeight: "700" },
  error: { color: theme.danger, fontSize: 12, marginTop: 6 },
});
