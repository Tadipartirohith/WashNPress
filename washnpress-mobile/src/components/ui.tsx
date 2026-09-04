import { useEffect, useRef, useState, type ReactNode } from "react";
import { themed } from "./themed";
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  useWindowDimensions, type LayoutChangeEvent,
} from "react-native";
import { font,
  theme, space, type, mono, radius, border, elevation, opacity, size, stateColor, labelFor,
} from "../theme";
import { Icon } from "./icon";
import { Animated, Enter, Pulse, usePressMotion } from "./motion";
import { cardBasisPercent, columnsFor, fieldWidth, type ColumnRule, type FieldWidth } from "./layout";
import type { SlotWindows } from "../api/types";

// The primitives every screen in both applications is built from.
//
// Two things changed here beyond the colours. Every size, weight and radius now
// comes from a token rather than from whatever number the screen that first needed
// it happened to use, and every control that answers to a finger now says so: it
// has a pressed state, a role, and at least forty-four points of target. The
// counter buttons were thirty-four across and the tab strip about thirty-three,
// which is small enough that missing one is ordinary rather than unlucky.

export function Screen({ children, refreshing, onRefresh, padded = true, resetOn }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  // What, when it changes, means this is a different page rather than the same
  // page with different content — a chosen record, a tab. Opening a record from
  // halfway down a long list used to land the reader halfway down the record,
  // because a screen that switches by state keeps the one scroll position it has
  // always had. Screens that swap component wholesale get this for free from the
  // remount; screens that keep the same Screen and change what is inside it need
  // to say so.
  resetOn?: unknown;
}) {
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    // Not animated: this is where the page begins, not a movement the reader is
    // meant to watch.
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [resetOn]);

  return (
    <ScrollView
      ref={scroller}
      style={styles.screen}
      contentContainerStyle={{ padding: padded ? space.page : 0, paddingBottom: space.block }}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.brand.solid} /> : undefined}
    >
      {/* The page arrives rather than being there already. One short rise for the
          whole screen, not one per element: a page where forty things fade in
          separately is a page nobody can read for two seconds. */}
      <Enter>{children}</Enter>
    </ScrollView>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string | null; right?: ReactNode }) {
  return (
    <View style={styles.pageTitleRow}>
      <View style={styles.pageTitleText}>
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children, action, collapsed }: {
  children: ReactNode;
  action?: ReactNode;
  // Nothing is being shown under this heading at the moment.
  //
  // The bottom margin is the gap between a heading and its own content, and a
  // collapsed section has none — so it was paying for a gap to nothing, and where
  // one collapsed section sat directly above another the two margins stacked into
  // 32 points of empty page. Styles do not collapse margins here the way they do in
  // a browser, so the heading has to be told.
  collapsed?: boolean;
}) {
  return (
    <View style={[styles.sectionRow, collapsed && styles.sectionRowCollapsed]}>
      <Text style={styles.h2} accessibilityRole="header">{children}</Text>
      {action}
    </View>
  );
}

// A card lifts by being lighter than the page it sits on, edged with a hairline.
// There is no shadow: depth from a shadow under every box is what makes a screen
// look muddy, and a page of twenty cards each casting one looks like a page of
// twenty problems.
export function Card({ children, onPress, style, elevated }: {
  children: ReactNode;
  onPress?: () => void;
  style?: object;
  // For the one card on a screen that should read as an object rather than as a
  // region. Not a default: twenty cards each casting a shadow is twenty problems.
  elevated?: boolean;
}) {
  const press = usePressMotion(Boolean(onPress));
  if (!onPress) return <View style={[styles.card, elevated && elevation.card, style]}>{children}</View>;
  return (
    <Animated.View style={press.style}>
      <Pressable
        style={({ pressed }) => [
          styles.card, elevated && elevation.card, pressed && styles.cardPressed, style,
        ]}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      hitSlop={10}
      style={({ pressed }) => [styles.backRow, pressed && styles.pressedFaint]}
    >
      <Icon name="chevronLeft" size={size.icon.sm} color={theme.text.link} />
      <Text style={styles.back}>{label}</Text>
    </Pressable>
  );
}

// A dashboard number. Tapping it opens the matching list, which is what every
// dashboard in the specification asks for.
export function Stat({ label, value, onPress, tone }: { label: string; value: number | string; onPress?: () => void; tone?: "default" | "warn" | "danger" | "good" }) {
  const color = tone === "warn" ? theme.feedback.warningText
    : tone === "danger" ? theme.feedback.dangerText
    : tone === "good" ? theme.feedback.successText
    : theme.text.primary;
  const press = usePressMotion(Boolean(onPress));
  const body = (
    <>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </>
  );
  if (!onPress) return <View style={styles.statInner}>{body}</View>;
  return (
    <>
      <Animated.View style={press.style}>
        <Pressable
          style={({ pressed }) => [styles.statInner, styles.statPressable, pressed && styles.statPressed]}
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value}`}
        >
          {body}
        </Pressable>
      </Animated.View>
    </>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  // Three across leaves a four-tile group with one tile alone on the second row,
  // which reads as a layout that ran out rather than one that was arranged. Four
  // is two by two. Everything else stays on three.
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  const half = items.length === 4 || items.length === 2;
  return (
    <View style={styles.statGrid}>
      {items.map((child, index) => (
        // eslint-disable-next-line react/no-array-index-key -- the caller keys the tile
        <View key={index} style={half ? styles.statCellHalf : styles.statCellThird}>{child}</View>
      ))}
    </View>
  );
}

export function Row({ label, value, figure, hint }: {
  label: string;
  value: ReactNode;
  // A second line under the label, for the qualification a label cannot carry
  // without becoming a sentence: "3 in your plan, 1 beyond it" belongs to the line
  // it describes, not squeezed into its name.
  hint?: string;
  // Set in the mono family, for a value somebody reads digit by digit or reads off
  // to somebody else: an order code, a phone number, a count in a column. Opt-in
  // rather than the default, because most of what a row carries is words, and
  // words set in a monospace read as a terminal.
  figure?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelCell}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text
        style={[styles.rowValue, figure && mono, empty && styles.rowValueEmpty]}
        numberOfLines={2}
      >
        {empty ? "—" : value}
      </Text>
    </View>
  );
}

// Status as a chip tinted in its own colour.
//
// It was a hairline outline, which is quiet and correct and reads as a form field.
// A wash of the status colour at eight percent gives the chip a body without
// turning a page of six statuses into a bag of sweets, and the label stays the
// full-strength colour, so the pair is a tint of a hue against text of the same
// hue: legible by construction rather than by luck.
export function Pill({ text, color }: { text: string; color?: string }) {
  const c = color ?? theme.brand.solid;
  return (
    <View style={[styles.pill, { backgroundColor: `${c}14`, borderColor: `${c}2E` }]}>
      <Text style={[styles.pillText, { color: c }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export function StatePill({ state }: { state: string }) {
  return <Pill text={labelFor(state)} color={stateColor[state] ?? theme.text.secondary} />;
}

export function Button({ label, onPress, disabled, loading, selected, variant = "primary" }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  // A button that is also a choice: a day of the week, a block, a reason. The tick
  // used to be a character glued to the front of the label, which meant a screen
  // reader announced the ballot-box character and nothing announced the state.
  selected?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const off = Boolean(disabled || loading);
  const base = variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : styles.btnSecondary;
  const pressedStyle = variant === "primary" ? styles.btnPrimaryPressed
    : variant === "danger" ? styles.btnDangerPressed : styles.btnSecondaryPressed;
  const textStyle = variant === "primary" ? styles.btnPrimaryText
    : variant === "danger" ? styles.btnDangerText : styles.btnSecondaryText;
  const press = usePressMotion(!off);
  return (
    <Animated.View style={press.style}>
    <Pressable
      style={({ pressed }) => [base, pressed && !off && pressedStyle, off && styles.btnDisabled]}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: Boolean(loading), selected }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? theme.text.onAction : theme.brand.solid}
          style={styles.btnSpinner}
        />
      ) : null}
      {selected && !loading ? (
        <View style={styles.btnSpinner}>
          <Icon
            name="check"
            size={size.icon.sm}
            color={variant === "primary" ? theme.text.onAction : theme.brand.solid}
            strokeWidth={2.5}
          />
        </View>
      ) : null}
      <Text style={textStyle} numberOfLines={1}>{label}</Text>
    </Pressable>
    </Animated.View>
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
  // A focused field draws its own outline in the brand colour rather than relying
  // on the keyboard appearing to tell somebody where they are typing.
  const [focused, setFocused] = useState(false);
  const onLayout = (e: LayoutChangeEvent) => setAvailable(e.nativeEvent.layout.width);
  const box = width === "full" || available === 0 ? undefined : { width: fieldWidth(width, Math.max(available, 120)) };
  return (
    <View style={[compact ? styles.fieldCompact : styles.field, box]} onLayout={onLayout}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.text.tertiary}
        keyboardType={keyboardType ?? "default"}
        secureTextEntry={secure}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
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
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  // Never more columns than there are cards.
  //
  // A three-column rule with two records drew two cards and reserved the third
  // column, so a page with one society showed it in the left third of the screen
  // with two thirds of blank beside it. The rule is a ceiling on how many fit,
  // not a promise that many exist.
  const count = Math.max(1, Math.min(columnsFor(available || width, columns), items.length));
  const basis = cardBasisPercent(count);
  return (
    <View style={styles.cardGrid} onLayout={onLayout}>
      {items.map((child, index) => (
        // eslint-disable-next-line react/no-array-index-key -- the caller keys the card itself
        <View key={index} style={[styles.cardCell, { width: `${basis}%` }]}>{child}</View>
      ))}
    </View>
  );
}

export function Counter({ label, value, onChange, max }: { label: string; value: number; onChange: (next: number) => void; max?: number }) {
  // A counter with a ceiling. Without a `max` it counts up freely; with one, the
  // plus button stops at the ceiling rather than letting a resident hold down "+"
  // and book an impossible quantity.
  const atMax = max != null && value >= max;
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counter}>
        <Pressable
          style={({ pressed }) => [styles.counterBtn, pressed && styles.counterBtnPressed]}
          onPress={() => onChange(Math.max(0, value - 1))}
          disabled={value <= 0}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          accessibilityState={{ disabled: value <= 0 }}
        >
          <Icon name="minus" size={size.icon.md} color={value <= 0 ? theme.text.disabled : theme.brand.solid} />
        </Pressable>
        <Text style={styles.counterValue} accessibilityLabel={`${label}, ${value}`}>{value}</Text>
        <Pressable
          style={({ pressed }) => [styles.counterBtn, pressed && styles.counterBtnPressed]}
          onPress={() => onChange(max != null ? Math.min(max, value + 1) : value + 1)}
          disabled={atMax}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          accessibilityState={{ disabled: atMax }}
        >
          <Icon name="plus" size={size.icon.md} color={atMax ? theme.text.disabled : theme.brand.solid} />
        </Pressable>
      </View>
    </View>
  );
}

export function Tabs<T extends string>({ options, value, onChange }: { options: { key: T; label: string; badge?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabs}
      contentContainerStyle={styles.tabsContent}
    >
      {options.map((option) => {
        const active = value === option.key;
        return (
          <Pressable
            key={option.key}
            style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressedFaint]}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {option.label}{option.badge ? ` ${option.badge}` : ""}
            </Text>
          </Pressable>
        );
      })}
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
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {names.map((name) => {
          const active = value === name;
          return (
            <Pressable
              key={name}
              style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressedFaint]}
              onPress={() => onChange(name)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.fieldHint}>
        {chosen ? `${to12Hour(chosen.startTime)} – ${to12Hour(chosen.endTime)}, fixed for this window` : "Choose a window"}
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
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>{error}</Text>
    </View>
  );
}

// Status is carried by the words and by a whole tinted surface, never by a coloured
// strip down one edge: a four-pixel bar is a decoration somebody has to already
// know the meaning of.
export function Notice({ text, tone = "info" }: { text: string; tone?: "info" | "warn" | "good" }) {
  const bg = tone === "warn" ? theme.feedback.warningTint
    : tone === "good" ? theme.feedback.successTint
    : theme.brand.tint;
  const fg = tone === "warn" ? theme.feedback.warningText
    : tone === "good" ? theme.feedback.successText
    : theme.text.primary;
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[styles.noticeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <ActivityIndicator color={theme.brand.solid} />
    </View>
  );
}

// A progress bar used for subscription allowance.
export function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={styles.meterTrack}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}
    >
      <View
        style={[
          styles.meterFill,
          { width: `${clamped}%`, backgroundColor: clamped >= 90 ? theme.feedback.warningSolid : theme.brand.solid },
        ]}
      />
    </View>
  );
}

// The order tracking timeline: completed, current and pending stages.
// Where the order is, as a line rather than as a list of ticks.
//
// The marks were already here and the rail between them was not, which left four
// unconnected icons that had to be read one at a time to work out how far along
// something was. A filled rail answers that before any label is: the eye follows the
// line to where the colour stops.
//
// One mark breathes — the current one, and only the current one. It is the only
// looping animation in either application, because a screen with two things pulsing
// has nothing that reads as now.
export function Timeline({ stages }: { stages: { state: string; label: string; status: string }[] }) {
  return (
    <View style={styles.timeline}>
      {stages.map((stage, index) => {
        const done = stage.status === "completed";
        const now = stage.status === "current";
        const color = done ? theme.feedback.successText : now ? theme.brand.solid : theme.text.tertiary;
        const last = index === stages.length - 1;
        return (
          <View key={stage.state} style={styles.timelineRow}>
            <View style={styles.timelineGutter}>
              <View style={styles.timelineMark}>
                <Pulse active={now}>
                  <Icon name={done ? "checkCircle" : "circle"} size={size.icon.sm} color={color} strokeWidth={done ? 2.25 : 1.75} />
                </Pulse>
              </View>
              {/* The rail belongs to the stage above it, so it is coloured by whether
                  that stage has happened rather than by the one it points at. */}
              {last ? null : <View style={[styles.timelineRail, done && styles.timelineRailDone]} />}
            </View>
            <Text style={[styles.timelineLabel, !done && !now && styles.timelineLabelPending, now && styles.timelineLabelNow]}>
              {stage.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = themed((theme) => ({
  screen: { flex: 1, backgroundColor: theme.surface.page },

  pageTitleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: space.base },
  pageTitleText: { flex: 1, paddingRight: space.base },
  h1: { ...type.title, color: theme.text.primary },
  subtitle: { ...type.caption, color: theme.text.tertiary, marginTop: space.tight },
  sectionRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: space.section, marginBottom: space.snug,
  },
  // A heading with nothing under it keeps the space above it, which is the section
  // boundary, and drops the space below it, which is the gap to content there is
  // none of.
  sectionRowCollapsed: { marginBottom: 0 },
  rowLabelCell: { flex: 1, marginRight: space.snug },
  rowHint: { ...type.caption, color: theme.text.tertiary, marginTop: 2 },
  h2: { ...type.heading, color: theme.text.primary, flex: 1, marginRight: space.snug },

  backRow: { flexDirection: "row", alignItems: "center", marginBottom: space.snug, alignSelf: "flex-start", minHeight: size.control.sm },
  back: { ...type.label, color: theme.text.link, marginLeft: space.tight },

  card: {
    backgroundColor: theme.surface.card,
    borderRadius: radius.md,
    padding: space.card,
    marginBottom: space.snug,
    borderWidth: border.hairline,
    borderColor: theme.line.subtle,
  },
  cardPressed: { backgroundColor: theme.brand.tintFaint, borderColor: theme.brand.tint },

  statGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space.tight },
  statCellThird: { width: "33.33%", paddingHorizontal: space.tight, marginBottom: space.snug },
  statCellHalf: { width: "50%", paddingHorizontal: space.tight, marginBottom: space.snug },
  statInner: { minHeight: size.touch, justifyContent: "center", paddingVertical: space.tight },
  statPressable: { borderRadius: radius.sm },
  statPressed: { backgroundColor: theme.brand.tintFaint },
  statValue: { ...type.metric },
  statLabel: { ...type.caption, color: theme.text.tertiary, marginTop: space.tight },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, alignItems: "flex-start" },
  rowLabel: { ...type.caption, color: theme.text.tertiary, flex: 1, paddingRight: space.snug },
  rowValue: { ...type.label, color: theme.text.primary, flex: 1.4, textAlign: "right" },
  rowValueEmpty: { color: theme.text.tertiary, fontFamily: font.medium },

  pill: {
    borderWidth: border.hairline,
    borderRadius: radius.pill,
    paddingHorizontal: space.snug,
    paddingVertical: 3,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  pillText: { ...type.overline },

  btnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: theme.action.primary,
    borderRadius: radius.md,
    minHeight: size.control.md,
    paddingHorizontal: space.page,
    marginTop: space.snug,
  },
  btnPrimaryPressed: { backgroundColor: theme.action.primaryPressed },
  btnPrimaryText: { ...type.bodyStrong, color: theme.text.onAction },
  btnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderColor: theme.action.secondaryBorder,
    borderWidth: border.hairline,
    borderRadius: radius.md,
    minHeight: size.control.md,
    paddingHorizontal: space.page,
    marginTop: space.snug,
    backgroundColor: theme.surface.card,
  },
  btnSecondaryPressed: { backgroundColor: theme.action.secondaryPressed },
  btnSecondaryText: { ...type.bodyStrong, color: theme.action.secondaryBorder },
  btnDanger: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderColor: theme.action.destructive,
    borderWidth: border.hairline,
    borderRadius: radius.md,
    minHeight: size.control.md,
    paddingHorizontal: space.page,
    marginTop: space.snug,
    backgroundColor: theme.surface.card,
  },
  btnDangerPressed: { backgroundColor: theme.action.destructivePressed },
  btnDangerText: { ...type.bodyStrong, color: theme.action.destructive },
  btnDisabled: { opacity: opacity.disabled },
  btnSpinner: { marginRight: space.snug },

  field: { marginBottom: space.snug, marginTop: space.snug },
  // In a filter row, where it lines up with the dropdowns beside it.
  fieldCompact: { marginBottom: space.snug, marginRight: space.base },
  fieldLabel: { ...type.caption, color: theme.text.tertiary, marginBottom: space.tight },
  fieldHint: { ...type.caption, color: theme.text.secondary, marginTop: space.tight },
  input: {
    backgroundColor: theme.surface.card,
    borderRadius: radius.md,
    minHeight: size.control.md,
    paddingVertical: space.base,
    paddingHorizontal: space.base,
    ...type.body,
    borderWidth: border.hairline,
    borderColor: theme.line.strong,
    color: theme.text.primary,
  },
  inputFocused: { borderColor: theme.line.focus, borderWidth: border.focus, paddingHorizontal: space.base - 1 },

  // Fields side by side, wrapping rather than running off the screen.
  fieldRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
  // Cards across a row. The cell carries the gap on its outer edge, so a grid lines
  // up with the text above it.
  cardGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start" },
  cardCell: { marginRight: "2%" },

  counterRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: theme.surface.card,
    borderRadius: radius.md,
    paddingLeft: space.card,
    paddingRight: space.snug,
    paddingVertical: space.snug,
    marginBottom: space.snug,
    borderWidth: border.hairline,
    borderColor: theme.line.subtle,
  },
  counterLabel: { ...type.body, color: theme.text.primary, flex: 1, marginRight: space.snug },
  counter: { flexDirection: "row", alignItems: "center" },
  counterBtn: {
    width: size.touch, height: size.touch, borderRadius: radius.sm,
    backgroundColor: theme.brand.tintFaint,
    alignItems: "center", justifyContent: "center",
  },
  counterBtnPressed: { backgroundColor: theme.brand.tint },
  counterValue: { width: 48, textAlign: "center", ...type.subheading, ...mono, color: theme.text.primary },

  tabs: {
    flexGrow: 0,
    backgroundColor: theme.surface.card,
    borderBottomWidth: border.hairline,
    borderBottomColor: theme.line.subtle,
  },
  tabsContent: { paddingHorizontal: space.base },
  tab: {
    minHeight: size.touch,
    justifyContent: "center",
    paddingHorizontal: space.base,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: theme.action.primary },
  tabText: { ...type.label, color: theme.text.tertiary },
  tabTextActive: { color: theme.text.primary, fontFamily: font.black },

  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: space.snug, marginRight: -space.snug },
  chip: {
    borderWidth: border.hairline,
    borderColor: theme.line.strong,
    backgroundColor: theme.surface.card,
    borderRadius: radius.pill,
    minHeight: size.control.sm,
    justifyContent: "center",
    paddingHorizontal: space.base,
    marginRight: space.snug,
    marginBottom: space.snug,
  },
  chipActive: { borderColor: theme.brand.solid, backgroundColor: theme.brand.tint },
  chipText: { ...type.label, color: theme.text.secondary },
  chipTextActive: { color: theme.text.primary, fontFamily: font.black },

  empty: {
    ...type.body,
    color: theme.text.tertiary,
    marginTop: space.page,
    marginBottom: space.snug,
    textAlign: "center",
  },
  errorBox: {
    backgroundColor: theme.feedback.dangerTint,
    borderRadius: radius.sm,
    padding: space.base,
    marginTop: space.snug,
  },
  errorText: { ...type.label, color: theme.feedback.dangerText, fontFamily: font.semi },
  notice: { borderRadius: radius.sm, padding: space.base, marginTop: space.snug },
  noticeText: { ...type.caption, fontFamily: font.semi },
  loading: { padding: space.section, alignItems: "center" },

  meterTrack: {
    height: 8, borderRadius: radius.pill,
    backgroundColor: theme.surface.sunken,
    overflow: "hidden", marginTop: space.snug,
  },
  meterFill: { height: 8, borderRadius: radius.pill },

  timeline: { marginTop: space.snug },
  // The row no longer centres its mark: the rail has to run from one mark to the
  // next, so the gutter is a column of its own and the label sits against the top of
  // it.
  timelineRow: { flexDirection: "row", alignItems: "stretch" },
  timelineGutter: { width: space.section, alignItems: "flex-start" },
  timelineMark: { paddingVertical: space.tight },
  timelineRail: {
    width: 2, flex: 1, minHeight: space.base, borderRadius: radius.pill,
    backgroundColor: theme.line.subtle, marginLeft: 7,
  },
  timelineRailDone: { backgroundColor: theme.feedback.successText },
  timelineLabel: { ...type.label, color: theme.text.primary, paddingVertical: space.snug },
  timelineLabelNow: { fontFamily: font.black },
  timelineLabelPending: { color: theme.text.tertiary, fontFamily: font.medium },

  pressedFaint: { opacity: opacity.pressed },
}));

export { styles as uiStyles };

// Somebody's approval, where they are managed.
//
// This used to be its own page: an admin who had just created a supervisor had to go
// to a Verification screen to let them in, and an operator's approval lived nowhere
// near the operator. Approving somebody is part of managing them.
export function VerificationTags({ status, active }: { status?: string | null; active?: boolean }) {
  const state = status ?? null;
  return (
    <View style={verification.tags}>
      {/* Only where there is an approval worth reporting. Passing no status says
          "this person's approval is not a thing anyone tracks here" — which is the
          case for supervisors, approved by the admin who creates them — and used
          to be answered with a permanent "Approved" badge next to "Active". */}
      {state === null ? null : (
        <Pill
          text={state === "pending" ? "Pending approval" : state === "rejected" ? "Rejected" : "Approved"}
          color={state === "pending" ? theme.feedback.warningText : state === "rejected" ? theme.feedback.dangerText : theme.feedback.successText}
        />
      )}
      {active === undefined ? null : (
        <Pill text={active ? "Active" : "Inactive"} color={active ? theme.feedback.successText : theme.text.tertiary} />
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
      <View style={verification.actions}>
        <Button label={state === "rejected" ? "Approve anyway" : "Approve"} onPress={onApprove} />
        {state === "pending" ? <Button label="Reject" variant="danger" onPress={onReject} /> : null}
      </View>
    </>
  );
}

const verification = StyleSheet.create({
  tags: { flexDirection: "row", gap: space.snug, flexWrap: "wrap" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.snug, marginTop: space.snug },
});
