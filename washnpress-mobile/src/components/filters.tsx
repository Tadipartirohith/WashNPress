import { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, Pressable,
  useWindowDimensions, type LayoutChangeEvent,
} from "react-native";
import { theme } from "../theme";
import { Field, Button } from "./ui";
import { fieldWidth, placeDropdown, type Rect } from "./layout";

// Filters, done the same way everywhere.
//
// The portals had grown a different filtering idiom per screen: a row of chips here,
// a stack of full-width buttons there, a bare text field somewhere else. Six options
// as six buttons is a row of buttons wider than the screen, and it says nothing about
// which of them is a filter and which is an action.
//
// So every choice between several things is one component, and it is a dropdown: one
// compact field showing what is currently chosen, opening a list of what else there
// is. The list is drawn in an overlay above the whole page rather than inside the
// form, which is the only way it can be guaranteed not to be painted behind the field
// below it or clipped by a parent that scrolls.

export interface FilterOption { value: string; label: string; count?: number }

export interface FilterSpec {
  key: string;
  label: string;
  options: FilterOption[];
  // What "no filter" is called in this list: "All areas", "Any status".
  allLabel?: string;
  // A filter with nothing worth choosing between is not shown at all.
  hideWhenEmpty?: boolean;
  // A dependent filter — societies before an area is chosen — says why it is shut
  // rather than opening on an empty list.
  disabled?: boolean;
  hint?: string;
}

export type FilterValues = Record<string, string | undefined>;

export function countActive(values: FilterValues): number {
  return Object.values(values).filter((v) => v !== undefined && v !== "").length;
}

// One choice between several things.
//
// The list opens in an overlay anchored to the field, so it is in front of
// everything, is never clipped by a parent's overflow, closes when something is
// chosen or when anything outside it is tapped, and scrolls when there is more than
// fits. Every dropdown in every portal is this one.
export function Dropdown({
  label, value, options, onChange, allLabel = "All", disabled, hint, width = "medium", allowClear = true,
}: {
  label?: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (next: string | undefined) => void;
  allLabel?: string;
  disabled?: boolean;
  hint?: string;
  width?: "small" | "medium" | "wide" | "full";
  // A dropdown that is a field rather than a filter — the society an operator is
  // being assigned to — has no "All" row, because there is no such answer.
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const [available, setAvailable] = useState(0);
  const trigger = useRef<View>(null);
  const screen = useWindowDimensions();
  const chosen = options.find((o) => o.value === value);

  const rows = options.length + (allowClear ? 1 : 0);
  const placement = useMemo(
    () => placeDropdown(anchor, { width: screen.width, height: screen.height }, { count: rows }),
    [anchor, screen.width, screen.height, rows],
  );

  // Measured at the moment it is opened rather than kept up to date, because the
  // only position that matters is where the field is when somebody taps it.
  const openList = useCallback(() => {
    if (disabled) return;
    const node = trigger.current;
    if (!node || typeof node.measureInWindow !== "function") { setOpen(true); return; }
    node.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
      setOpen(true);
    });
  }, [disabled]);

  // Choosing an option closes the list. It used to stay open behind a full-screen
  // sheet, so the person who had just chosen had to dismiss the thing they had
  // finished with.
  const choose = (next: string | undefined) => { onChange(next); setOpen(false); };

  const onWrapLayout = (e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width);
  const box = width === "full" || available === 0
    ? undefined
    : { width: fieldWidth(width, Math.max(available, 120)) };

  return (
    <View style={[styles.dropdownWrap, box]} onLayout={onWrapLayout}>
      {label ? <Text style={styles.dropdownLabel}>{label}</Text> : null}
      <View ref={trigger} collapsable={false}>
        <TouchableOpacity
          style={[styles.dropdown, disabled && styles.dropdownDisabled]}
          onPress={openList}
          accessibilityRole="button"
          accessibilityState={{ expanded: open, disabled: Boolean(disabled) }}
        >
          {/* What is chosen, said plainly, so the field reads as an answer rather
              than as a button waiting to be pressed. */}
          <Text style={[styles.dropdownValue, !chosen && styles.dropdownPlaceholder]} numberOfLines={1}>
            {chosen?.label ?? allLabel}
          </Text>
          <Text style={styles.dropdownCaret}>{open ? "▴" : "▾"}</Text>
        </TouchableOpacity>
      </View>
      {disabled && hint ? <Text style={styles.dropdownHint}>{hint}</Text> : null}

      {/* Above the page, not inside the form. A modal is the one layer nothing in
          the form can paint over and no parent can clip. */}
      <Modal visible={open && !disabled} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityRole="button" />
        <View
          style={[styles.popover, {
            left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight + 2,
          }]}
        >
          <ScrollView style={{ maxHeight: placement.maxHeight }} keyboardShouldPersistTaps="handled">
            {allowClear ? (
              <TouchableOpacity
                style={[styles.option, !value && styles.optionActive]}
                onPress={() => choose(undefined)}
              >
                <Text style={[styles.optionText, !value && styles.optionTextActive]}>{allLabel}</Text>
                {!value ? <Text style={styles.tick}>{"✓"}</Text> : null}
              </TouchableOpacity>
            ) : null}
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, value === option.value && styles.optionActive]}
                onPress={() => choose(option.value)}
              >
                <Text style={[styles.optionText, value === option.value && styles.optionTextActive]} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.count !== undefined ? <Text style={styles.optionCount}>{option.count}</Text> : null}
                {value === option.value ? <Text style={styles.tick}>{"✓"}</Text> : null}
              </TouchableOpacity>
            ))}
            {options.length === 0 ? (
              <Text style={styles.optionEmpty}>{hint ?? "Nothing to choose from."}</Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// The filters for a list, above the list.
//
// Compact fields that wrap, rather than rows of buttons: every filter narrows what
// is shown, they combine, and one Clear filters puts them all back. The count is
// there so somebody looking at an unexpectedly short list can see why it is short.
export function FilterRow({
  specs, values, onChange, search, onSearch, searchPlaceholder = "Search", extra, onClear,
}: {
  specs: FilterSpec[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  search?: string;
  onSearch?: (next: string) => void;
  searchPlaceholder?: string;
  extra?: React.ReactNode;
  // Some screens have state of their own to reset alongside the filters.
  onClear?: () => void;
}) {
  const shown = specs.filter((spec) => !spec.hideWhenEmpty || spec.options.length > 0);
  const active = countActive(values) + (search ? 1 : 0);

  const clear = () => {
    onChange({});
    onSearch?.("");
    onClear?.();
  };

  return (
    <View style={styles.filterRow}>
      {onSearch ? (
        <View style={styles.searchCell}>
          <Field
            label="Search" value={search ?? ""} onChangeText={onSearch}
            placeholder={searchPlaceholder} width="wide" compact
          />
        </View>
      ) : null}
      {shown.map((spec) => (
        <Dropdown
          key={spec.key}
          label={spec.label}
          value={values[spec.key]}
          options={spec.options}
          allLabel={spec.allLabel ?? "All"}
          disabled={spec.disabled}
          hint={spec.hint}
          onChange={(next) => onChange({ ...values, [spec.key]: next })}
        />
      ))}
      {extra}
      {active > 0 ? (
        <View style={styles.clearCell}>
          <TouchableOpacity style={styles.clear} onPress={clear} accessibilityRole="button">
            <Text style={styles.clearText}>{`Clear filters (${active})`}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// Yes or no, as a toggle rather than as two buttons that look like actions.
export function Toggle({ label, value, onChange, hint }: {
  label: string; value: boolean; onChange: (next: boolean) => void; hint?: string;
}) {
  return (
    <TouchableOpacity style={styles.toggleRow} onPress={() => onChange(!value)} accessibilityRole="switch">
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </TouchableOpacity>
  );
}

// Anything that cannot be undone asks first, and says what it is about to do rather
// than only that it is about to do something.
export function ConfirmDialog({ visible, title, message, confirmLabel = "Confirm", destructive, onConfirm, onCancel }: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogBody}>{message}</Text>
          <View style={styles.actions}>
            <View style={{ flex: 1, marginRight: 6 }}><Button label="Cancel" variant="secondary" onPress={onCancel} /></View>
            <View style={{ flex: 1, marginLeft: 6 }}>
              <Button label={confirmLabel} variant={destructive ? "danger" : "primary"} onPress={onConfirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// A compact table, for the lists the requirements ask to stop being large cards.
export function DataTable<T>({ columns, rows, keyOf, onPress, empty = "Nothing to show." }: {
  columns: { key: string; label: string; width?: number; render: (row: T) => React.ReactNode }[];
  rows: T[];
  keyOf: (row: T) => string;
  onPress?: (row: T) => void;
  empty?: string;
}) {
  if (!rows.length) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.headRow}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.headCell, { width: c.width ?? 110 }]} numberOfLines={1}>{c.label}</Text>
          ))}
        </View>
        {rows.map((row) => (
          <TouchableOpacity
            key={keyOf(row)}
            style={styles.bodyRow}
            onPress={onPress ? () => onPress(row) : undefined}
            disabled={!onPress}
          >
            {columns.map((c) => (
              <View key={c.key} style={{ width: c.width ?? 110, paddingRight: 8 }}>{c.render(row)}</View>
            ))}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

// "Showing 1–20 of 156", and the way to see the rest.
export function Pager({ page, onChange }: {
  page: { total: number; limit: number; offset: number; hasMore: boolean };
  onChange: (offset: number) => void;
}) {
  if (page.total === 0) return null;
  const first = page.offset + 1;
  const last = Math.min(page.offset + page.limit, page.total);
  return (
    <View style={styles.pager}>
      <TouchableOpacity
        disabled={page.offset === 0}
        onPress={() => onChange(Math.max(0, page.offset - page.limit))}
      >
        <Text style={[styles.pagerBtn, page.offset === 0 && styles.pagerDisabled]}>‹ Previous</Text>
      </TouchableOpacity>
      <Text style={styles.pagerText}>Showing {first}–{last} of {page.total}</Text>
      <TouchableOpacity disabled={!page.hasMore} onPress={() => onChange(page.offset + page.limit)}>
        <Text style={[styles.pagerBtn, !page.hasMore && styles.pagerDisabled]}>Next ›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownWrap: { marginBottom: 10, marginRight: 10 },
  dropdownLabel: { fontSize: 12, color: theme.muted, marginBottom: 5 },
  dropdown: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: theme.white, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: theme.border,
  },
  dropdownValue: { fontSize: 15, color: theme.slate, flex: 1 },
  dropdownPlaceholder: { color: theme.muted },
  dropdownDisabled: { opacity: 0.5 },
  dropdownHint: { fontSize: 11, color: theme.muted, marginTop: 4 },
  dropdownCaret: { fontSize: 14, color: theme.muted, marginLeft: 8 },

  // Positioned by placeDropdown, inside the overlay. Nothing in the page can be
  // above this, because the page is not this component's parent.
  popover: {
    position: "absolute", zIndex: 1000, elevation: 24,
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border,
    borderRadius: 10, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  optionEmpty: { fontSize: 12, color: theme.muted, padding: 12 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  option: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 11, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  optionActive: { backgroundColor: theme.ice },
  optionText: { fontSize: 15, color: theme.slate, flex: 1 },
  optionTextActive: { color: theme.deepTeal, fontWeight: "700" },
  optionCount: { fontSize: 12, color: theme.muted, marginLeft: 8 },
  tick: { fontSize: 13, color: theme.deepTeal, marginLeft: 8, fontWeight: "800" },

  // Wraps rather than scrolls: filters that run off the side of the screen are
  // filters nobody knows are there.
  filterRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", marginBottom: 4 },
  searchCell: { marginRight: 10 },
  clearCell: { marginBottom: 10, justifyContent: "flex-end" },
  clear: {
    borderWidth: 1, borderColor: theme.deepTeal, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, backgroundColor: theme.white,
  },
  clearText: { fontSize: 13, color: theme.deepTeal, fontWeight: "700" },

  actions: { flexDirection: "row", marginTop: 12 },

  toggleRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: theme.white,
    borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border,
  },
  toggleLabel: { fontSize: 15, color: theme.slate, fontWeight: "600" },
  toggleHint: { fontSize: 12, color: theme.muted, marginTop: 2 },
  track: { width: 46, height: 26, borderRadius: 13, backgroundColor: theme.border, padding: 3 },
  trackOn: { backgroundColor: theme.success },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.white },
  knobOn: { alignSelf: "flex-end" },

  dialog: { backgroundColor: theme.bg, borderRadius: 16, padding: 20, margin: 20, alignSelf: "center", width: "88%" },
  dialogTitle: { fontSize: 17, fontWeight: "800", color: theme.deepTeal },
  dialogBody: { fontSize: 14, color: theme.slate, marginTop: 8, lineHeight: 20 },

  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 8, marginBottom: 4 },
  headCell: { fontSize: 11, fontWeight: "800", color: theme.muted, textTransform: "uppercase" },
  bodyRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  empty: { fontSize: 13, color: theme.muted, textAlign: "center", paddingVertical: 18 },

  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  pagerBtn: { fontSize: 13, color: theme.deepTeal, fontWeight: "700" },
  pagerDisabled: { color: theme.border },
  pagerText: { fontSize: 12, color: theme.muted },
});
