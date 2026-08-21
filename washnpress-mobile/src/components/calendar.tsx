import React, { useMemo, useState } from "react";
import { Modal, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { theme } from "../theme";

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
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => undefined}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setYear(year - 1)} style={styles.nav}><Text style={styles.navText}>{"«"}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => step(-1)} style={styles.nav}><Text style={styles.navText}>{"‹"}</Text></TouchableOpacity>
            <Text style={styles.title}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => step(1)} style={styles.nav}><Text style={styles.navText}>{"›"}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setYear(year + 1)} style={styles.nav}><Text style={styles.navText}>{"»"}</Text></TouchableOpacity>
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
        </TouchableOpacity>
      </TouchableOpacity>
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

const styles = StyleSheet.create({
  field: { marginBottom: 10 },
  label: { fontSize: 12, color: theme.muted, marginBottom: 5 },
  row: { flexDirection: "row", alignItems: "center" },
  input: {
    flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: "#fff",
  },
  value: { fontSize: 14, color: theme.deepTeal, fontWeight: "600" },
  placeholder: { fontSize: 14, color: theme.muted },
  clear: { marginLeft: 8, paddingHorizontal: 10, paddingVertical: 10 },
  clearText: { fontSize: 12, color: theme.aqua, fontWeight: "700" },

  backdrop: { flex: 1, backgroundColor: "rgba(9,32,32,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 16, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  nav: { paddingHorizontal: 8, paddingVertical: 4 },
  navText: { fontSize: 18, color: theme.aqua, fontWeight: "800" },
  title: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800", color: theme.deepTeal },
  weekRow: { flexDirection: "row" },
  weekday: { width: `${100 / 7}%`, textAlign: "center", fontSize: 11, color: theme.muted, fontWeight: "700", marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  cellSelected: { backgroundColor: theme.aqua },
  cellToday: { borderWidth: 1, borderColor: theme.aqua },
  day: { fontSize: 14, color: theme.deepTeal },
  daySelected: { color: "#fff", fontWeight: "800" },
  dayBlocked: { color: theme.border },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border },
  footerAction: { fontSize: 13, color: theme.aqua, fontWeight: "700" },
});
