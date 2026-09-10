import { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { themed } from "./themed";
import { space, type, radius, size, border } from "../theme";

// The last thing between a render that threw and a white screen.
//
// There was no boundary anywhere in either application. React's behaviour when a
// render throws and nothing catches it is to unmount the entire tree — so one bad
// field on one order, one response shaped differently from its type, took the whole
// app to a blank page with no message, no way back, and nothing for the person
// holding the phone to do except force-quit it and hope. On an operator's handset,
// mid-collection, that is a shift's context gone.
//
// A boundary cannot undo the fault, but it can keep the app. It says what happened
// in a sentence, and offers the one action that actually helps: throw away the
// broken render and mount the tree again. Most of these are transient — a value that
// was null this once — and coming back is the whole recovery.
//
// It has to be a class. `getDerivedStateFromError` has no hook equivalent; there is
// no `useErrorBoundary`.

interface Props {
  children: ReactNode;
  // Called before the tree is mounted again, for whatever the app wants to stand
  // down first. Optional, and never given the error: deciding what to do about a
  // particular fault is not a boundary's business.
  onReset?: () => void;
}

interface State {
  error: Error | null;
  // Bumped on every reset, and used as the key on the subtree. Clearing the error
  // alone would re-render the same components with the same state — including the
  // state that made them throw — and they would throw again immediately. The key
  // makes it a fresh mount.
  generation: number;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // There is no crash reporter wired up here. Until there is, the console is the
    // only place the component stack survives, and a development build is where
    // somebody is actually looking at it.
    if (__DEV__) console.error("Render failed", error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.props.onReset?.();
    this.setState((prev) => ({ error: null, generation: prev.generation + 1 }));
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return <View key={this.state.generation} style={styles.pass}>{this.props.children}</View>;

    return (
      <View style={styles.page}>
        <Text style={styles.title} accessibilityRole="header">Something went wrong</Text>
        <Text style={styles.body}>
          This screen could not be drawn. Nothing you had already saved is affected —
          it is on the server, not on this phone.
        </Text>
        <Pressable style={styles.action} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.actionText}>Reload the app</Text>
        </Pressable>
        {/* The fault itself, where somebody can act on it. A release build shows the
            sentence above and nothing else: a stack trace tells the person holding
            the phone nothing and reads as the app being broken beyond use. */}
        {__DEV__ ? <Text style={styles.detail}>{error.message}</Text> : null}
      </View>
    );
  }
}

const styles = themed((theme) => ({
  // Transparent and full height, so wrapping the tree in this changes nothing about
  // how the tree lays out.
  pass: { flex: 1 },
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.section,
    backgroundColor: theme.surface.page,
  },
  title: { ...type.title, color: theme.text.primary, textAlign: "center" },
  body: {
    ...type.body, color: theme.text.secondary, textAlign: "center",
    marginTop: space.snug, marginBottom: space.section, maxWidth: 420,
  },
  action: {
    minHeight: size.control.md,
    justifyContent: "center",
    paddingHorizontal: space.section,
    borderRadius: radius.md,
    backgroundColor: theme.action.primary,
  },
  actionText: { ...type.bodyStrong, color: theme.text.onAction },
  detail: {
    ...type.caption, color: theme.text.tertiary, textAlign: "center",
    marginTop: space.section, maxWidth: 420,
    borderTopWidth: border.hairline, borderTopColor: theme.line.subtle, paddingTop: space.snug,
  },
}));
