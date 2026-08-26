import { useState, type ReactNode } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  useWindowDimensions, type LayoutChangeEvent,
} from "react-native";
import { theme, stateColor, labelFor } from "../theme";
import { cardBasisPercent, columnsFor, fieldWidth, type ColumnRule, type FieldWidth } from "./layout";
import type { SlotWindows } from "../api/types";

// A small set of primitives shared by all four portals, so a dashboard tile, a
// status pill or a data row looks and behaves the same wherever it appears.

export function Screen({ children, refreshing, onRefresh, padded = true }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: padded ? 16 : 0, paddingBottom: 48 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string | null; right?: ReactNode }) {
  return (
    <View style={styles.pageTitleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.h1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.h2}>{children}</Text>
      {action}
    </View>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: object }) {
  if (onPress) {
    return <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.7}>{children}</TouchableOpacity>;
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress}><Text style={styles.back}>{`‹ ${label}`}</Text></TouchableOpacity>;
}

// A dashboard number. Tapping it navigates to the matching detailed list, which is
// what the specification asks for on every dashboard.
export function Stat({ label, value, onPress, tone }: { label: string; value: number | string; onPress?: () => void; tone?: "default" | "warn" | "danger" | "good" }) {
  const color = tone === "warn" ? theme.amber : tone === "danger" ? theme.danger : tone === "good" ? theme.success : theme.deepTeal;
  const body = (
    <>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) return <TouchableOpacity style={styles.stat} onPress={onPress} activeOpacity={0.7}>{body}</TouchableOpacity>;
  return <View style={styles.stat}>{body}</View>;
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value === null || value === undefined || value === "" ? "—" : value}</Text>
    </View>
  );
}

export function Pill({ text, color }: { text: string; color?: string }) {
  const c = color ?? theme.aqua;
  return <View style={[styles.pill, { borderColor: c }]}><Text style={[styles.pillText, { color: c }]}>{text}</Text></View>;
}

export function StatePill({ state }: { state: string }) {
  return <Pill text={labelFor(state)} color={stateColor[state] ?? theme.slate} />;
}

export function Button({ label, onPress, disabled, variant = "primary" }: { label: string; onPress: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }) {
  const style = variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : styles.btnSecondary;
  const textStyle = variant === "primary" ? styles.btnPrimaryText : variant === "danger" ? styles.btnDangerText : styles.btnSecondaryText;
  return (
    <TouchableOpacity style={[style, disabled && styles.btnDisabled]} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      <Text style={textStyle}>{label}</Text>
    </TouchableOpacity>
  );
}

// A field is as wide as what goes in it.
//
// Everything here used to be full width, so a form asking for six prices was six
// boxes the width of the screen each holding four characters. The width is now part
// of what the field is: small for a price or a count, medium for a dropdown or a
// date, wide for a search box, full for a paragraph.
export function Field({
  label, value, onChangeText, placeholder, keyboardType, secure, width = "full", compact, hint,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: "default" | "number-pad" | "phone-pad" | "email-address"; secure?: boolean;
  width?: FieldWidth;
  // Sits in a filter row rather than in a form, so it lines up with the dropdowns
  // beside it instead of with the fields above it.
  compact?: boolean;
  hint?: string;
}) {
  const [available, setAvailable] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width);
  const box = width === "full" || available === 0 ? undefined : { width: fieldWidth(width, Math.max(available, 120)) };
  return (
    <View style={[compact ? styles.fieldCompact : styles.field, box]} onLayout={onLayout}>
      <Text style={compact ? styles.fieldLabelCompact : styles.fieldLabel}>{label}</Text>
      <TextInput
        style={compact ? styles.inputCompact : styles.input}
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={theme.muted} keyboardType={keyboardType ?? "default"} secureTextEntry={secure}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// Several fields side by side, wrapping when they run out of room. What makes a
// compact width worth having: without it, a narrow field is a narrow field with a
// large empty space next to it.
export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

// Cards across a row rather than stacked one per screen width.
//
// Every management screen was a column of full-width cards with most of each card
// empty, so seeing six of anything meant scrolling past six screens of whitespace.
// How many fit is a decision per screen — supervisors three across, QC records four,
// orders two — and it steps down on a tablet and again on a phone.
export function CardGrid({ children, columns }: { children: ReactNode; columns: ColumnRule }) {
  const { width } = useWindowDimensions();
  const [available, setAvailable] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width);
  const count = columnsFor(available || width, columns);
  const basis = cardBasisPercent(count);
  const items = Array.isArray(children) ? children : [children];
  return (
    <View style={styles.cardGrid} onLayout={onLayout}>
      {items.filter(Boolean).map((child, index) => (
        // eslint-disable-next-line react/no-array-index-key -- the caller keys the card itself
        <View key={index} style={[styles.cardCell, { width: `${basis}%` }]}>{child}</View>
      ))}
    </View>
  );
}

export function Counter({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counter}>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.max(0, value - 1))}><Text style={styles.counterBtnText}>−</Text></TouchableOpacity>
        <Text style={styles.counterValue}>{value}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(value + 1)}><Text style={styles.counterBtnText}>+</Text></TouchableOpacity>
      </View>
    </View>
  );
}

export function Tabs<T extends string>({ options, value, onChange }: { options: { key: T; label: string; badge?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: 12 }}>
      {options.map((option) => (
        <TouchableOpacity key={option.key} style={[styles.tab, value === option.key && styles.tabActive]} onPress={() => onChange(option.key)}>
          <Text style={[styles.tabText, value === option.key && styles.tabTextActive]}>
            {option.label}{option.badge ? ` (${option.badge})` : ""}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// The slot windows are fixed, and their hours come from the backend rather than
// from whoever is filling in the form. The picker shows the hours it is about to
// commit to, read only, so a supervisor can see what "Morning" means before
// creating the slot and can never create two Morning slots with different hours.
export const DEFAULT_SLOT_WINDOWS: SlotWindows = {
  Morning: { startTime: "09:00", endTime: "12:00" },
  Afternoon: { startTime: "13:00", endTime: "16:00" },
  Evening: { startTime: "17:00", endTime: "20:00" },
};

export function SlotWindowPicker({ windows, value, onChange }: {
  windows: SlotWindows; value: string; onChange: (next: string) => void;
}) {
  const names = Object.keys(windows);
  const chosen = windows[value];
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Window</Text>
      <View style={styles.chipRow}>
        {names.map((name) => (
          <TouchableOpacity
            key={name}
            style={[styles.chip, value === name ? styles.chipActive : null]}
            onPress={() => onChange(name)}
          >
            <Text style={[styles.chipText, value === name ? styles.chipTextActive : null]}>{name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldHint}>
        {chosen ? `${to12Hour(chosen.startTime)} – ${to12Hour(chosen.endTime)} · fixed for this window` : "Choose a window"}
      </Text>
    </View>
  );
}

// "09:00" reads as 9:00 AM to the people using this, not as a 24-hour clock.
export function to12Hour(hhmm: string): string {
  const [h, m] = String(hhmm ?? "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm ?? "";
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>;
}

export function Notice({ text, tone = "info" }: { text: string; tone?: "info" | "warn" | "good" }) {
  const bg = tone === "warn" ? "#FFF3DC" : tone === "good" ? "#E4F5EC" : theme.ice;
  const fg = tone === "warn" ? "#7A5200" : tone === "good" ? theme.success : theme.deepTeal;
  return <View style={[styles.notice, { backgroundColor: bg }]}><Text style={[styles.noticeText, { color: fg }]}>{text}</Text></View>;
}

export function Loading() {
  return <View style={styles.loading}><ActivityIndicator color={theme.aqua} /></View>;
}

// A progress bar used for subscription allowance.
export function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.meterTrack}>
      <View style={[styles.meterFill, { width: `${clamped}%`, backgroundColor: clamped >= 90 ? theme.amber : theme.aqua }]} />
    </View>
  );
}

// The order tracking timeline: completed, current and pending stages.
export function Timeline({ stages }: { stages: { state: string; label: string; status: string }[] }) {
  return (
    <View style={{ marginTop: 8 }}>
      {stages.map((stage) => {
        const mark = stage.status === "completed" ? "✓" : stage.status === "current" ? "●" : "○";
        const color = stage.status === "completed" ? theme.success : stage.status === "current" ? theme.aqua : theme.muted;
        return (
          <View key={stage.state} style={styles.timelineRow}>
            <Text style={[styles.timelineMark, { color }]}>{mark}</Text>
            <Text style={[styles.timelineLabel, stage.status === "pending" && { color: theme.muted }]}>{stage.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  pageTitleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: "800", color: theme.deepTeal },
  subtitle: { fontSize: 13, color: theme.muted, marginTop: 2 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 22, marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: "700", color: theme.slate },
  back: { color: theme.aqua, fontSize: 15, marginBottom: 10 },
  card: { backgroundColor: theme.white, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
  statGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  stat: { width: "33.33%", paddingHorizontal: 4, marginBottom: 10 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: 11, color: theme.muted, marginTop: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  rowLabel: { fontSize: 13, color: theme.muted, flex: 1 },
  rowValue: { fontSize: 13, color: theme.slate, fontWeight: "600", flex: 1.4, textAlign: "right" },
  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: "700" },
  btnPrimary: { backgroundColor: theme.aqua, borderRadius: 10, padding: 14, marginTop: 12, alignItems: "center" },
  btnPrimaryText: { color: theme.white, fontWeight: "700", fontSize: 15 },
  btnSecondary: { borderColor: theme.aqua, borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 10, alignItems: "center" },
  btnSecondaryText: { color: theme.aqua, fontWeight: "700", fontSize: 15 },
  btnDanger: { borderColor: theme.danger, borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 10, alignItems: "center" },
  btnDangerText: { color: theme.danger, fontWeight: "700", fontSize: 15 },
  btnDisabled: { opacity: 0.45 },
  field: { marginBottom: 10, marginTop: 12 },
  // In a filter row, where it lines up with the dropdowns beside it.
  fieldCompact: { marginBottom: 10, marginRight: 10 },
  fieldLabel: { fontSize: 12, color: theme.muted, marginBottom: 5 },
  fieldLabelCompact: { fontSize: 12, color: theme.muted, marginBottom: 5 },
  fieldHint: { fontSize: 12, color: theme.deepTeal, marginTop: 8, fontWeight: "600" },
  input: { backgroundColor: theme.white, borderRadius: 10, padding: 12, fontSize: 15, borderWidth: 1, borderColor: theme.border, color: theme.slate },
  inputCompact: {
    backgroundColor: theme.white, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    fontSize: 15, borderWidth: 1, borderColor: theme.border, color: theme.slate,
  },
  // Fields side by side, wrapping rather than running off the screen.
  fieldRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
  // Cards across a row. The negative margin cancels the gap the cells add on their
  // outer edges, so a grid lines up with the text above it.
  cardGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start" },
  cardCell: { marginRight: "2%" },
  counterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: theme.white, borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  counterLabel: { fontSize: 15, color: theme.deepTeal, fontWeight: "600" },
  counter: { flexDirection: "row", alignItems: "center" },
  counterBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.ice, alignItems: "center", justifyContent: "center" },
  counterBtnText: { fontSize: 20, color: theme.deepTeal, fontWeight: "800" },
  counterValue: { width: 40, textAlign: "center", fontSize: 17, fontWeight: "700", color: theme.slate },
  tabs: { flexGrow: 0, backgroundColor: theme.white, borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { paddingVertical: 12, paddingHorizontal: 12 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: theme.aqua },
  tabText: { fontSize: 13, color: theme.muted, fontWeight: "600" },
  tabTextActive: { color: theme.deepTeal, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.white, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6, marginRight: 6, marginBottom: 6 },
  chipActive: { borderColor: theme.aqua, backgroundColor: theme.ice },
  chipText: { fontSize: 12, color: theme.muted, fontWeight: "600" },
  chipTextActive: { color: theme.deepTeal, fontWeight: "800" },
  empty: { color: theme.muted, marginTop: 18, textAlign: "center", fontSize: 13 },
  errorBox: { backgroundColor: "#FDECEA", borderRadius: 8, padding: 10, marginTop: 12 },
  errorText: { color: theme.danger, fontSize: 13 },
  notice: { borderRadius: 8, padding: 10, marginTop: 10 },
  noticeText: { fontSize: 12, fontWeight: "600" },
  loading: { padding: 30, alignItems: "center" },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: theme.border, overflow: "hidden", marginTop: 6 },
  meterFill: { height: 8, borderRadius: 4 },
  timelineRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  timelineMark: { width: 22, fontSize: 15, fontWeight: "800" },
  timelineLabel: { fontSize: 14, color: theme.slate, fontWeight: "600" },
});

export { styles as uiStyles };

// Somebody's approval, where they are managed.
//
// This used to be its own page: an admin who had just created a supervisor had to go
// to a Verification screen to let them in, and an operator's approval lived nowhere
// near the operator. Approving somebody is part of managing them.
export function VerificationTags({ status, active }: { status?: string | null; active?: boolean }) {
  const state = status ?? "approved";
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      <Pill
        text={state === "pending" ? "Pending approval" : state === "rejected" ? "Rejected" : "Approved"}
        color={state === "pending" ? theme.amber : state === "rejected" ? theme.danger : theme.success}
      />
      {active === undefined ? null : (
        <Pill text={active ? "Active" : "Inactive"} color={active ? theme.success : theme.muted} />
      )}
    </View>
  );
}

// The decision itself, offered only while there is one to make.
export function VerificationActions({ status, onApprove, onReject, note }: {
  status?: string | null;
  onApprove: () => void;
  onReject: () => void;
  // Why this person can or cannot be approved by whoever is looking.
  note?: string | null;
}) {
  const state = status ?? "approved";
  if (state === "approved") return null;
  return (
    <>
      {note ? <Notice tone="warn" text={note} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <Button label={state === "rejected" ? "Approve anyway" : "Approve"} onPress={onApprove} />
        {state === "pending" ? <Button label="Reject" variant="danger" onPress={onReject} /> : null}
      </View>
    </>
  );
}
