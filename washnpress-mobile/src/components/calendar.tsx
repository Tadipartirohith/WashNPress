import React, { useMemo, useState } from "react";
import { themed } from "./themed";
import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { font, theme, space, type, mono, radius, border, elevation, size } from "../theme";
import { Icon } from "./icon";

// A date picker that works the same on iOS, Android and the web, without pulling in
// a native picker that behaves differently on each. Nobody should have to type
// YYYY-MM-DD, and nobody should be able to enter a date that does not exist.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// Dates are handled as YYYY-MM-DD strings throughout, because that is what the API
// takes and it avoids a timezone turning one day into its neighbour.
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatFriendly(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1].slice(0, 3)} ${String(d).padStart(2, "0")}, ${y}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Monday first, which is how the operation is rostered.
function leadingBlanks(year: number, month: number): number {
  return (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DateField({
  label, value, onChange, placeholder = "Select date", clearable = true, minDate, maxDate,
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  minDate?: string;
  maxDate?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.input} onPress={() => setOpen(true)} activeOpacity={0.7}>
          <Text style={value ? styles.value : styles.placeholder}>
            {value ? `\u{1F4C5}  ${formatFriendly(value)}` : `\u{1F4C5}  ${placeholder}`}
          </Text>
        </TouchableOpacity>
        {clearable && value ? (
          <TouchableOpacity style={styles.clear} onPress={() => onChange(null)} activeOpacity={0.7}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <CalendarModal
        visible={open}
        value={value}
        minDate={minDate}
        maxDate={maxDate}
        onClose={() => setOpen(false)}
        onPick={(next) => { onChange(next); setOpen(false); }}
      />
    </View>
  );
}

function CalendarModal({
  visible, value, onPick, onClose, minDate, maxDate,
}: {
  visible: boolean;
  value: string | null;
  onPick: (iso: string) => void;
  onClose: () => void;
  minDate?: string;
  maxDate?: string;
}) {
  const start = value ?? todayIso();
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1);

  const grid = useMemo(() => {
    const cells: (number | null)[] = Array(leadingBlanks(year, month)).fill(null);
    for (let d = 1; d <= daysInMonth(year, month); d += 1) cells.push(d);
    return cells;
  }, [year, month]);

  const step = (delta: number) => {
    const next = month + delta;
    if (next < 0) { setMonth(11); setYear(year - 1); return; }
    if (next > 11) { setMonth(0); setYear(year + 1); return; }
    setMonth(next);
  };

  const today = todayIso();
  const blocked = (day: number) => {
    const d = iso(year, month, day);
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The dismissing layer is a sibling of the sheet, never its parent: a
          pressable ancestor on web claims Enter and Space from everything inside
          it, so a nested backdrop turns arrow-key navigation of the grid into a
          close. See the note in components/modal.tsx. */}
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Nav label="Previous year" onPress={() => setYear(year - 1)} icon="chevronLeft" double />
            <Nav label="Previous month" onPress={() => step(-1)} icon="chevronLeft" />
            <Text style={styles.title} accessibilityRole="header">{MONTHS[month]} {year}</Text>
            <Nav label="Next month" onPress={() => step(1)} icon="chevronRight" />
            <Nav label="Next year" onPress={() => setYear(year + 1)} icon="chevronRight" double />
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => <Text key={w} style={styles.weekday}>{w}</Text>)}
          </View>

          <View style={styles.grid}>
            {grid.map((day, index) => {
              if (day == null) return <View key={`blank-${index}`} style={styles.cell} />;
              const d = iso(year, month, day);
              const isSelected = d === value;
              const isToday = d === today;
              const isBlocked = blocked(day);
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.cell, isSelected && styles.cellSelected, isToday && !isSelected && styles.cellToday]}
                  disabled={isBlocked}
                  onPress={() => onPick(d)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.day, isSelected && styles.daySelected, isBlocked && styles.dayBlocked]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={() => onPick(today)} activeOpacity={0.7}>
              <Text style={styles.footerAction}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.footerAction}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Today, yesterday, this week and so on, so a common range is one tap rather than
// two date pickers. The values match what the backend resolves.
export const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]["value"];

// A month or year step. Named so a screen reader says which, because four
// chevrons in a row are otherwise four identical unlabelled buttons.
function Nav({ label, onPress, icon, double }: {
  label: string;
  onPress: () => void;
  icon: "chevronLeft" | "chevronRight";
  double?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.nav, pressed && styles.navPressed]}
    >
      <View style={styles.navGlyphs}>
        <Icon name={icon} size={size.icon.md} color={theme.text.secondary} />
        {double ? (
          <View style={styles.navSecond}>
            <Icon name={icon} size={size.icon.md} color={theme.text.secondary} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = themed((theme) => ({
  field: { marginBottom: space.snug },
  label: { ...type.caption, color: theme.text.tertiary, marginBottom: space.tight },
  row: { flexDirection: "row", alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: border.hairline,
    borderColor: theme.line.strong,
    borderRadius: radius.md,
    minHeight: size.control.md,
    justifyContent: "center",
    paddingHorizontal: space.base,
    backgroundColor: theme.surface.card,
  },
  inputPressed: { backgroundColor: theme.brand.tintFaint },
  value: { ...type.body, color: theme.text.primary, fontFamily: font.semi },
  placeholder: { ...type.body, color: theme.text.tertiary },
  clear: {
    marginLeft: space.snug,
    minWidth: size.touch, minHeight: size.touch,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.sm,
  },
  clearPressed: { backgroundColor: theme.surface.sunken },
  clearText: { ...type.caption, color: theme.text.link, fontFamily: font.bold },

  backdrop: {
    flex: 1, backgroundColor: theme.surface.scrim,
    alignItems: "center", justifyContent: "center", padding: space.section,
  },
  sheet: {
    width: "100%", maxWidth: 360,
    backgroundColor: theme.surface.raised,
    borderRadius: radius.lg,
    padding: space.page,
    ...elevation.overlay,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.base },
  nav: {
    width: size.touch, height: size.touch, borderRadius: radius.sm,
    alignItems: "center", justifyContent: "center",
  },
  navPressed: { backgroundColor: theme.surface.sunken },
  navGlyphs: { flexDirection: "row", alignItems: "center" },
  navSecond: { marginLeft: -11 },
  title: { flex: 1, textAlign: "center", ...type.subheading, color: theme.text.primary },
  weekRow: { flexDirection: "row" },
  weekday: {
    width: `${100 / 7}%`, textAlign: "center",
    ...type.overline, color: theme.text.tertiary, marginBottom: space.tight,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`, aspectRatio: 1,
    alignItems: "center", justifyContent: "center",
    borderRadius: radius.sm,
  },
  cellPressed: { backgroundColor: theme.brand.tintFaint },
  cellSelected: { backgroundColor: theme.action.primary },
  cellToday: { borderWidth: border.focus, borderColor: theme.brand.solid },
  day: { ...type.body, ...mono, color: theme.text.primary },
  daySelected: { color: theme.text.onAction, fontFamily: font.black },
  dayBlocked: { color: theme.text.disabled },
  footer: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: space.base, paddingTop: space.base,
    borderTopWidth: border.hairline, borderTopColor: theme.line.subtle,
  },
  footerAction: {
    ...type.label, color: theme.text.link, fontFamily: font.bold,
    minHeight: size.control.sm, textAlignVertical: "center",
  },
}));

// Two dates that mean one thing: the span a list is being narrowed to.
//
// Kept together rather than as two independent filters, because "from the 3rd" and
// "to the 1st" is not a range anybody meant — the end is held to the start, so the
// pair cannot be put into a state that returns nothing for a reason nobody can see.
export function DateRangeFields({ from, to, onChange }: {
  from?: string;
  to?: string;
  onChange: (next: { from?: string; to?: string }) => void;
}) {
  return (
    <>
      <DateField
        label="From"
        value={from ?? null}
        maxDate={to}
        onChange={(next) => onChange({ from: next ?? undefined, to })}
        placeholder="Any date"
      />
      <DateField
        label="To"
        value={to ?? null}
        minDate={from}
        onChange={(next) => onChange({ from, to: next ?? undefined })}
        placeholder="Any date"
      />
    </>
  );
}
