import { useState, type ReactNode } from "react";
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable, useWindowDimensions,
} from "react-native";
import { theme } from "../theme";
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
          panel, which is what stops the list behind from being interactive. */}
      <Pressable style={styles.backdrop} onPress={attemptClose} accessibilityRole="button">
        {/* Stops a tap inside the panel reaching the backdrop and closing it. */}
        <Pressable
          style={[styles.panel, { width: panelWidth, maxHeight: screen.height - (wide ? 80 : 40) }]}
          onPress={() => {}}
        >
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity onPress={attemptClose} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.close}>{"✕"}</Text>
            </TouchableOpacity>
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
        </Pressable>
      </Pressable>
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
              <Text style={[styles.dotText, (done || now) && styles.dotTextOn]}>
                {done ? "✓" : String(index + 1)}
              </Text>
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
    backgroundColor: "rgba(15, 30, 30, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  panel: {
    backgroundColor: theme.bg,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 28, shadowOffset: { width: 0, height: 12 },
    elevation: 24,
  },
  head: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    backgroundColor: theme.white,
  },
  title: { fontSize: 17, fontWeight: "800", color: theme.deepTeal },
  subtitle: { fontSize: 12, color: theme.muted, marginTop: 2 },
  close: { fontSize: 18, color: theme.muted, paddingHorizontal: 6, paddingVertical: 2 },
  body: { paddingHorizontal: 18, paddingVertical: 14 },
  footer: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
    backgroundColor: theme.white,
  },
  confirm: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 0,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  confirmText: { fontSize: 15, color: theme.slate, textAlign: "center", lineHeight: 21, marginBottom: 16 },
  confirmActions: { flexDirection: "row", alignSelf: "stretch" },

  steps: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  step: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  dot: {
    width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.white, borderWidth: 1, borderColor: theme.border,
  },
  dotDone: { backgroundColor: theme.success, borderColor: theme.success },
  dotNow: { backgroundColor: theme.deepTeal, borderColor: theme.deepTeal },
  dotText: { fontSize: 11, fontWeight: "800", color: theme.muted },
  dotTextOn: { color: theme.white },
  stepLabel: { fontSize: 12, color: theme.muted, marginLeft: 6, flexShrink: 1 },
  stepLabelNow: { color: theme.deepTeal, fontWeight: "700" },
  rail: { width: 18, height: 1, backgroundColor: theme.border, marginHorizontal: 8 },
  railDone: { backgroundColor: theme.success },

  wizardFooter: { flexDirection: "row" },
});
