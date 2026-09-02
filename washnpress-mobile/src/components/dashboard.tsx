import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { themed } from "./themed";
import { Card, SectionTitle } from "./ui";
import { Icon } from "./icon";
import { Animated, usePressMotion } from "./motion";
import {
  liveExceptions, allClearLine, busiestStage, pipelineTotal,
  type Exception, type PipelineStage,
} from "../portals/dashboard-rules";
import { theme, space, type, radius, border, size, font } from "../theme";

// The three pieces every dashboard is now built from.
//
// They existed before as one thing — a section heading over a grid of identical
// tiles — repeated five or six times down the page. That shape gives a failed
// pickup exactly as much of the screen as the number of towers in a society, so
// the reader has to check all twenty to find the one that is not routine.

// ------------------------------------------------------------------ exceptions

// What needs a person, and nothing else.
//
// Rendered as rows rather than tiles: a row can carry a sentence, tiles can only
// carry a number, and "3" is not the point — "3 pickups failed this morning" is.
// On a good day this is one calm line, which is a thing worth being able to see
// at a glance.
export function AttentionBand({ items, scope, onOpen }: {
  items: Exception[];
  // Where "nothing needs attention" applies: your blocks, this society, the
  // platform. Without it the reassurance is vague enough to distrust.
  scope: string;
  onOpen?: (item: Exception) => void;
}) {
  const live = liveExceptions(items);

  if (!live.length) {
    return (
      <Card>
        <View style={styles.clearRow}>
          <Icon name="checkCircle" size={size.icon.md} color={theme.feedback.successText} />
          <Text style={styles.clearText}>{allClearLine(scope)}</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      {live.map((item, index) => (
        <AttentionRow
          key={item.key}
          item={item}
          first={index === 0}
          onPress={onOpen ? () => onOpen(item) : undefined}
        />
      ))}
    </Card>
  );
}

function AttentionRow({ item, first, onPress }: { item: Exception; first: boolean; onPress?: () => void }) {
  const press = usePressMotion(Boolean(onPress));
  const tone = item.tone === "danger" ? theme.feedback.dangerText : theme.feedback.warningText;
  const body = (
    <View style={[styles.attentionRow, !first && styles.attentionDivided]}>
      <View style={[styles.attentionMark, { backgroundColor: tone }]} />
      <Text style={styles.attentionCount}>{item.count}</Text>
      <Text style={styles.attentionLabel} numberOfLines={2}>{item.label}</Text>
      {onPress ? <Icon name="chevronRight" size={size.icon.sm} color={theme.text.tertiary} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`${item.count} ${item.label}`}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

// ------------------------------------------------------------------- pipeline

// Where the work is, as a flow rather than as a set of counters.
//
// Fifteen tiles cannot say that everything is stuck in washing; eight stages in
// the order the work moves through them say it without being read. The bar under
// each stage is its share of what is in the pipeline, so the pile-up is visible
// before any number is.
export function Pipeline({ stages, onOpen, emptyText = "Nothing is in progress." }: {
  stages: PipelineStage[];
  onOpen?: (stage: PipelineStage) => void;
  emptyText?: string;
}) {
  const total = pipelineTotal(stages);
  const busiest = busiestStage(stages);

  if (total === 0) return <Card><Text style={styles.pipelineEmpty}>{emptyText}</Text></Card>;

  return (
    <>
      <Card>
        {/* Scrolls sideways rather than squeezing.
            Eight stages across a phone gives each label about thirty points, which
            turned "Scheduled" into "Schedule d" and "Collected" into "Collecte d".
            A stage has a minimum width it needs to be readable at; below that the
            row scrolls, which is the same rule the data tables follow. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pipelineRow}>
          {stages.map((stage) => {
            const share = total > 0 ? stage.count / total : 0;
            const isBusiest = busiest?.key === stage.key;
            const colour = stage.stuck && stage.count > 0
              ? theme.feedback.dangerText
              : isBusiest ? theme.brand.solid : theme.line.strong;
            const cell = (
              <View style={styles.pipelineCell}>
                <Text
                  style={[
                    styles.pipelineCount,
                    stage.count === 0 && styles.pipelineCountEmpty,
                    stage.stuck && stage.count > 0 && styles.pipelineCountStuck,
                  ]}
                >
                  {stage.count}
                </Text>
                <Text style={styles.pipelineLabel} numberOfLines={2}>{stage.label}</Text>
                {/* The share of everything in flight. A minimum height so a stage
                    with one order in it is still visibly a stage. */}
                <View style={styles.pipelineTrack}>
                  <View style={[styles.pipelineFill, { backgroundColor: colour, width: `${Math.max(share * 100, stage.count > 0 ? 6 : 0)}%` }]} />
                </View>
              </View>
            );
            if (!onOpen) return <View key={stage.key} style={styles.pipelineItem}>{cell}</View>;
            return (
              <Pressable
                key={stage.key}
                style={styles.pipelineItem}
                onPress={() => onOpen(stage)}
                accessibilityRole="button"
                accessibilityLabel={`${stage.count} ${stage.label}`}
              >
                {cell}
              </Pressable>
            );
          })}
        </View>
        </ScrollView>
      </Card>
      {/* One sentence instead of comparing eight numbers. */}
      {busiest ? (
        <Text style={styles.pipelineNote}>
          {busiest.stuck
            ? `${busiest.count} order${busiest.count === 1 ? "" : "s"} stopped at ${busiest.label.toLowerCase()}.`
            : `Most of the work is at ${busiest.label.toLowerCase()} — ${busiest.count} of ${total}.`}
        </Text>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ reference

// The figures that describe the setup rather than the day: how many towers, how
// many residents, how many staff. They barely change between logins, so they read
// as one quiet line rather than as tiles competing with a failed pickup.
export function MetaStrip({ items, onOpen }: {
  items: { key: string; label: string; value: number | string }[];
  onOpen?: (key: string) => void;
}) {
  return (
    <View style={styles.metaStrip}>
      {items.map((item) => {
        const body = (
          <Text style={styles.metaItem}>
            <Text style={styles.metaValue}>{item.value}</Text>
            <Text style={styles.metaLabel}>{`  ${item.label}`}</Text>
          </Text>
        );
        if (!onOpen) return <View key={item.key} style={styles.metaCell}>{body}</View>;
        return (
          <Pressable
            key={item.key}
            style={styles.metaCell}
            onPress={() => onOpen(item.key)}
            accessibilityRole="button"
            accessibilityLabel={`${item.value} ${item.label}`}
          >
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

// A heading for the one thing a screen is actually about, so the primary answer
// is not the same size as everything under it.
export function LeadSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </>
  );
}

const styles = themed((theme) => ({
  clearRow: { flexDirection: "row", alignItems: "center", gap: space.base },
  clearText: { ...type.body, color: theme.text.secondary, flex: 1 },

  attentionRow: {
    flexDirection: "row", alignItems: "center", gap: space.base,
    paddingVertical: space.base,
  },
  attentionDivided: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line.subtle,
  },
  attentionMark: { width: 3, alignSelf: "stretch", borderRadius: radius.pill },
  attentionCount: { ...type.metric, color: theme.text.primary, minWidth: 44 },
  attentionLabel: { ...type.body, color: theme.text.secondary, flex: 1 },

  pipelineRow: { flexDirection: "row", alignItems: "flex-start" },
  // Wide enough for the longest stage name on two lines.
  pipelineItem: { width: 86 },
  pipelineCell: { paddingHorizontal: space.tight },
  pipelineCount: { ...type.heading, color: theme.text.primary },
  pipelineCountEmpty: { color: theme.text.tertiary },
  pipelineCountStuck: { color: theme.feedback.dangerText },
  pipelineLabel: { ...type.caption, color: theme.text.tertiary, marginTop: 2, minHeight: 32 },
  pipelineTrack: {
    height: 4, borderRadius: radius.pill, backgroundColor: theme.surface.sunken,
    marginTop: space.tight, overflow: "hidden",
  },
  pipelineFill: { height: 4, borderRadius: radius.pill },
  pipelineNote: { ...type.caption, color: theme.text.tertiary, marginTop: space.snug, marginBottom: space.base },
  pipelineEmpty: { ...type.body, color: theme.text.tertiary },

  metaStrip: {
    flexDirection: "row", flexWrap: "wrap",
    paddingVertical: space.snug,
    borderTopWidth: border.hairline, borderTopColor: theme.line.subtle,
    borderBottomWidth: border.hairline, borderBottomColor: theme.line.subtle,
    marginBottom: space.page,
  },
  metaCell: { marginRight: space.section, paddingVertical: space.tight },
  metaItem: { ...type.caption },
  metaValue: { fontFamily: font.bold, color: theme.text.primary },
  metaLabel: { color: theme.text.tertiary },
}));
