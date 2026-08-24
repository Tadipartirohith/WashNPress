import { useMemo, useState } from "react";
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { theme } from "../theme";
import { Field, Button } from "./ui";

// Filters, done the same way everywhere.
//
// The portals had grown a different filtering idiom per screen: a row of chips here,
// a stack of full-width buttons there, a bare text field somewhere else. On a phone
// a screen with six filters permanently open is mostly filters, so these live behind
// one drawer that says how many are active, and every screen gets the same Apply,
// Reset and search behaviour without having to reinvent it.

export interface FilterOption { value: string; label: string; count?: number }

export interface FilterSpec {
  key: string;
  label: string;
  options: FilterOption[];
  // A filter with nothing worth choosing between is not shown at all.
  hideWhenEmpty?: boolean;
}

export type FilterValues = Record<string, string | undefined>;

export function countActive(values: FilterValues): number {
  return Object.values(values).filter((v) => v !== undefined && v !== "").length;
}

// A dropdown, in the sense a phone can actually offer one: a labelled row that opens
// a sheet of choices. "All" is always first, because clearing one filter should not
// mean remembering which value meant "no filter".
export function Dropdown({ label, value, options, onChange, allLabel = "All" }: {
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (next: string | undefined) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={[styles.dropdownValue, !chosen && styles.dropdownPlaceholder]} numberOfLines={1}>
          {chosen?.label ?? allLabel}
        </Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity
                style={[styles.option, !value && styles.optionActive]}
                onPress={() => { onChange(undefined); setOpen(false); }}
              >
                <Text style={[styles.optionText, !value && styles.optionTextActive]}>{allLabel}</Text>
              </TouchableOpacity>
              {options.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, value === option.value && styles.optionActive]}
                  onPress={() => { onChange(option.value); setOpen(false); }}
                >
                  <Text style={[styles.optionText, value === option.value && styles.optionTextActive]}>
                    {option.label}
                  </Text>
                  {option.count !== undefined ? <Text style={styles.optionCount}>{option.count}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// The drawer. Closed it is one line saying how many filters are on; open it is the
// filters, a search box, and the two buttons that end the interaction.
export function FilterBar({ specs, values, onApply, search, onSearch, searchPlaceholder = "Search", extra }: {
  specs: FilterSpec[];
  values: FilterValues;
  onApply: (next: FilterValues) => void;
  search?: string;
  onSearch?: (next: string) => void;
  searchPlaceholder?: string;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterValues>(values);
  const [draftSearch, setDraftSearch] = useState(search ?? "");
  const active = useMemo(() => countActive(values) + (search ? 1 : 0), [values, search]);
  const shown = specs.filter((spec) => !spec.hideWhenEmpty || spec.options.length > 0);

  const apply = () => {
    onApply(draft);
    onSearch?.(draftSearch);
    setOpen(false);
  };

  const reset = () => {
    const cleared: FilterValues = {};
    setDraft(cleared);
    setDraftSearch("");
    onApply(cleared);
    onSearch?.("");
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.bar}
        onPress={() => { setDraft(values); setDraftSearch(search ?? ""); setOpen(true); }}
        accessibilityRole="button"
      >
        <Text style={styles.barText}>Filters</Text>
        {active > 0 ? (
          <View style={styles.badge}><Text style={styles.badgeText}>{active}</Text></View>
        ) : (
          <Text style={styles.barHint}>None</Text>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.drawer}>
            <View style={styles.drawerHead}>
              <Text style={styles.drawerTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setOpen(false)}><Text style={styles.close}>Close</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {onSearch ? (
                <Field label="Search" value={draftSearch} onChangeText={setDraftSearch} placeholder={searchPlaceholder} />
              ) : null}
              {shown.map((spec) => (
                <Dropdown
                  key={spec.key}
                  label={spec.label}
                  value={draft[spec.key]}
                  options={spec.options}
                  onChange={(next) => setDraft({ ...draft, [spec.key]: next })}
                />
              ))}
              {extra}
            </ScrollView>
            <View style={styles.actions}>
              <View style={{ flex: 1, marginRight: 6 }}><Button label="Reset" variant="secondary" onPress={reset} /></View>
              <View style={{ flex: 1, marginLeft: 6 }}><Button label="Apply" onPress={apply} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
  dropdownWrap: { marginBottom: 10 },
  dropdownLabel: { fontSize: 12, color: theme.muted, marginBottom: 5 },
  dropdown: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: theme.white, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: theme.border,
  },
  dropdownValue: { fontSize: 15, color: theme.slate, flex: 1 },
  dropdownPlaceholder: { color: theme.muted },
  dropdownCaret: { fontSize: 14, color: theme.muted, marginLeft: 8 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: theme.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: theme.deepTeal, marginBottom: 10 },
  option: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4,
    backgroundColor: theme.white,
  },
  optionActive: { backgroundColor: theme.ice },
  optionText: { fontSize: 15, color: theme.slate },
  optionTextActive: { color: theme.deepTeal, fontWeight: "700" },
  optionCount: { fontSize: 12, color: theme.muted },

  bar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: theme.white, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: theme.border, marginBottom: 10,
  },
  barText: { fontSize: 14, fontWeight: "700", color: theme.deepTeal },
  barHint: { fontSize: 12, color: theme.muted },
  badge: { backgroundColor: theme.deepTeal, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: theme.white, fontSize: 12, fontWeight: "800", textAlign: "center" },

  drawer: { backgroundColor: theme.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  drawerHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  drawerTitle: { fontSize: 18, fontWeight: "800", color: theme.deepTeal },
  close: { fontSize: 14, color: theme.muted },
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
