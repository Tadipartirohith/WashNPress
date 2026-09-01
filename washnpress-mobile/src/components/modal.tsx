import { useState, type ReactNode } from "react";
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable, useWindowDimensions,
} from "react-native";
import { font, theme, space, type, radius, border, elevation, size } from "../theme";
import { Icon } from "./icon";
import { Button } from "./ui";
import { breakpointFor } from "./layout";

// A panel in the middle of the screen, with the page behind it put out of reach.
//
// Creation forms used to open as another section of the page they were opened from.
// The list stayed live behind them, so a half-filled form sat above a grid of cards
// that could still be tapped, filtered and scrolled — and tapping one of them lost
// what had been typed. What is being filled in is the only thing that should answer
// to a tap while it is open.

export function CenteredModal({
  visible, title, subtitle, onClose, children, footer, width = "medium", dirty, discardMessage,
}: {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "medium" | "wide";
  // Whether anything has been typed. Closing with work in progress asks first;
  // closing an untouched form does not need to.
  dirty?: boolean;
  discardMessage?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const screen = useWindowDimensions();
  const wide = breakpointFor(screen.width) !== "mobile";
  const panelWidth = wide ? (width === "wide" ? 760 : 560) : screen.width - 24;

  const attemptClose = () => {
    if (dirty) { setConfirming(true); return; }
    onClose();
  };

  const discard = () => { setConfirming(false); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={attemptClose}>
      {/* The backdrop darkens the page and takes every tap that is not on the
          panel, which is what stops the list behind from being interactive.

          The layer that dismisses is a *sibling* of the panel rather than its
          parent, and that is load-bearing rather than a style choice. React
          Native Web turns a pressable into a keyboard-activatable control, and
          its key handler fires on `Enter` from any descendant whatsoever and on
          `Space` from any descendant carrying a button role — which every select,
          chip and stepper in these forms does. With the panel nested inside the
          dismisser, a resident pressing Space to type "Carpet cleaning", or Enter
          to move between fields, was pressing the backdrop: the form asked whether
          to discard, or simply closed. Nothing inside the panel can reach a
          sibling, so the question cannot arise. */}
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={attemptClose}
          // No role, so it never becomes focusable or keyboard-activatable. The
          // × button is the real control and is the only one a keyboard reaches.
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <View
          style={[styles.panel, { width: panelWidth, maxHeight: screen.height - (wide ? 80 : 40) }]}
        >
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={attemptClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            >
              <Icon name="close" size={size.icon.md} color={theme.text.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: screen.height - (wide ? 220 : 180) }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}

          {/* Asked inside the panel rather than as a second modal on top of it, so
              the question cannot end up behind the thing it is asking about. */}
          {confirming ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>
                {discardMessage ?? "Are you sure you want to discard what you have entered?"}
              </Text>
              <View style={styles.confirmActions}>
                <View style={{ flex: 1, marginRight: 6 }}>
                  <Button label="Keep editing" variant="secondary" onPress={() => setConfirming(false)} />
                </View>
                <View style={{ flex: 1, marginLeft: 6 }}>
                  <Button label="Discard" variant="danger" onPress={discard} />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// Which step of a wizard is being filled in, and how many there are.
//
// Without this a three-step form is a form that keeps changing, with no way to tell
// how much of it is left.
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View style={styles.steps}>
      {steps.map((label, index) => {
        const done = index < current;
        const now = index === current;
        return (
          <View key={label} style={styles.step}>
            <View style={[styles.dot, done && styles.dotDone, now && styles.dotNow]}>
              {done ? (
                <Icon name="check" size={size.icon.sm} color={theme.text.onAction} strokeWidth={2.5} />
              ) : (
                <Text style={[styles.dotText, now && styles.dotTextOn]}>{String(index + 1)}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, now && styles.stepLabelNow]} numberOfLines={1}>{label}</Text>
            {index < steps.length - 1 ? <View style={[styles.rail, done && styles.railDone]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// Back, Next and the final action, in the same place on every step.
export function WizardFooter({
  onBack, onNext, nextLabel = "Next", backLabel = "Back", nextDisabled, busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <View style={styles.wizardFooter}>
      <View style={{ flex: 1, marginRight: 6 }}>
        {onBack ? <Button label={backLabel} variant="secondary" onPress={onBack} /> : null}
      </View>
      <View style={{ flex: 1, marginLeft: 6 }}>
        <Button label={busy ? "Working…" : nextLabel} onPress={onNext} disabled={nextDisabled || busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Dark enough that the page behind reads as out of reach rather than merely
    // tinted, which is the whole point of it.
    backgroundColor: theme.surface.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: space.base,
  },
  panel: {
    backgroundColor: theme.surface.page,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...elevation.overlay,
  },
  head: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: space.section,
    paddingTop: space.page,
    paddingBottom: space.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line.subtle,
    backgroundColor: theme.surface.card,
  },
  title: { ...type.heading, color: theme.text.primary },
  subtitle: { ...type.caption, color: theme.text.tertiary, marginTop: space.tight },
  close: {
    width: size.touch, height: size.touch, borderRadius: radius.sm,
    alignItems: "center", justifyContent: "center",
    marginTop: -space.snug, marginRight: -space.base,
  },
  closePressed: { backgroundColor: theme.surface.sunken },
  body: { paddingHorizontal: space.section, paddingVertical: space.page },
  footer: {
    paddingHorizontal: space.section,
    paddingVertical: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.line.subtle,
    backgroundColor: theme.surface.card,
  },
  confirm: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 0,
    backgroundColor: theme.surface.card,
    alignItems: "center", justifyContent: "center",
    padding: space.section,
  },
  confirmText: { ...type.body, color: theme.text.primary, textAlign: "center", marginBottom: space.page },
  confirmActions: { flexDirection: "row", alignSelf: "stretch" },

  steps: { flexDirection: "row", alignItems: "center", marginBottom: space.page },
  step: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  dot: {
    width: 26, height: 26, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.surface.card,
    borderWidth: border.hairline,
    borderColor: theme.line.strong,
  },
  dotDone: { backgroundColor: theme.feedback.successText, borderColor: theme.feedback.successText },
  dotNow: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
  dotText: { ...type.overline, color: theme.text.tertiary, letterSpacing: 0 },
  dotTextOn: { color: theme.text.onAction },
  stepLabel: { ...type.caption, color: theme.text.tertiary, marginLeft: space.snug, flexShrink: 1 },
  stepLabelNow: { color: theme.text.primary, fontFamily: font.bold },
  rail: { width: 18, height: border.hairline, backgroundColor: theme.line.subtle, marginHorizontal: space.snug },
  railDone: { backgroundColor: theme.feedback.successText },

  wizardFooter: { flexDirection: "row" },
});
