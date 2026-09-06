import { View, Text, Pressable, ScrollView } from "react-native";
import { themed } from "./themed";
import { theme, space, type, font, radius, border, size } from "../theme";
import { Icon, type IconName } from "./icon";
import { Animated, usePressMotion } from "./motion";

// Top-level portal navigation, the way a phone does it rather than the way a
// website does it: a fixed bar at the bottom of the screen, icon over label,
// at most five destinations. Every portal has far more sections than that —
// the extra ones live behind the last slot, "More" (`MoreMenu` below), which
// is just a list that calls back into the same tab state the portal already
// has. Nothing about how a screen is built or reached from "More" changes;
// only what sits at the bottom of the frame does.

export interface BottomTabItem<T extends string> {
  key: T;
  label: string;
  icon: IconName;
  badge?: number;
}

export function BottomTabBar<T extends string>({ items, value, onChange }: {
  items: BottomTabItem<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {items.map((item) => (
        <BottomTabButton key={item.key} item={item} active={value === item.key} onPress={() => onChange(item.key)} />
      ))}
    </View>
  );
}

function BottomTabButton<T extends string>({ item, active, onPress }: {
  item: BottomTabItem<T>;
  active: boolean;
  onPress: () => void;
}) {
  const press = usePressMotion();
  const tint = active ? theme.brand.solid : theme.text.tertiary;
  return (
    <Animated.View style={[styles.tabItemWrap, press.style]}>
      <Pressable
        style={styles.tabItem}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.badge ? `${item.label}, ${item.badge} new` : item.label}
      >
        <View style={styles.tabIconSlot}>
          <Icon name={item.icon} size={size.icon.md} color={tint} strokeWidth={active ? 2.25 : 2} />
          {item.badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>{item.badge > 99 ? "99+" : item.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export interface MoreMenuRow {
  key: string;
  label: string;
  icon: IconName;
  badge?: number;
  onPress: () => void;
}

export interface MoreMenuSection {
  title?: string;
  items: MoreMenuRow[];
}

// What the "More" tab renders: everything that didn't fit in the bar, grouped
// so a long list (an admin has fourteen items here) still scans as a few
// labelled clusters rather than one flat wall of rows.
export function MoreMenu({ sections }: { sections: MoreMenuSection[] }) {
  return (
    <ScrollView contentContainerStyle={styles.menuContent}>
      {sections.map((section, si) => (
        // eslint-disable-next-line react/no-array-index-key -- a section has no id, and titles are not always unique
        <View key={si} style={styles.menuSection}>
          {section.title ? <Text style={styles.menuSectionTitle}>{section.title}</Text> : null}
          <View style={styles.menuGroup}>
            {section.items.map((row, ri) => (
              <MoreMenuRowButton key={row.key} row={row} last={ri === section.items.length - 1} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MoreMenuRowButton({ row, last }: { row: MoreMenuRow; last: boolean }) {
  const press = usePressMotion();
  return (
    <Animated.View style={press.style}>
      <Pressable
        style={[styles.menuRow, !last && styles.menuRowDivider]}
        onPress={row.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
      >
        <View style={styles.menuRowIcon}>
          <Icon name={row.icon} size={size.icon.md} color={theme.brand.solid} strokeWidth={2} />
        </View>
        <Text style={styles.menuRowLabel} numberOfLines={1}>{row.label}</Text>
        {row.badge ? (
          <View style={styles.menuRowBadge}>
            <Text style={styles.badgeText} numberOfLines={1}>{row.badge > 99 ? "99+" : row.badge}</Text>
          </View>
        ) : null}
        <Icon name="chevronRight" size={size.icon.sm} color={theme.text.tertiary} />
      </Pressable>
    </Animated.View>
  );
}

const styles = themed((theme) => ({
  bar: {
    flexDirection: "row",
    borderTopWidth: border.hairline,
    borderTopColor: theme.line.subtle,
    backgroundColor: theme.surface.card,
    paddingTop: space.snug,
    paddingBottom: space.snug,
  },
  tabItemWrap: { flex: 1 },
  tabItem: {
    flex: 1,
    minHeight: size.touch,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 2,
  },
  tabIconSlot: { alignItems: "center", justifyContent: "center" },
  tabLabel: { ...type.caption, fontFamily: font.medium, color: theme.text.tertiary },
  tabLabelActive: { color: theme.brand.solid, fontFamily: font.semi },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: theme.feedback.dangerSolid,
    alignItems: "center",
    justifyContent: "center",
  },
  // Plain white rather than `theme.text.onAction`: that token is paired with the
  // brand action colour specifically (near-black in dark mode, for a bright teal
  // fill) and reads poorly on the red danger fill this badge actually sits on.
  badgeText: { ...type.overline, fontSize: 10, lineHeight: 12, letterSpacing: 0, color: theme.white },

  menuContent: { padding: space.page, gap: space.section },
  menuSection: { gap: space.snug },
  menuSectionTitle: { ...type.overline, color: theme.text.tertiary, paddingHorizontal: space.tight },
  menuGroup: {
    borderRadius: radius.lg,
    backgroundColor: theme.surface.card,
    borderWidth: border.hairline,
    borderColor: theme.line.subtle,
    overflow: "hidden",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
    minHeight: size.touch,
    paddingHorizontal: space.card,
    paddingVertical: space.snug,
  },
  menuRowDivider: { borderBottomWidth: border.hairline, borderBottomColor: theme.line.subtle },
  menuRowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: theme.brand.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRowLabel: { ...type.body, color: theme.text.primary, flex: 1 },
  menuRowBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: theme.feedback.dangerSolid,
    alignItems: "center",
    justifyContent: "center",
  },
}));
