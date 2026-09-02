import { useCallback, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  Easing,
  withRepeat,
} from "react-native-reanimated";
import { motion, space } from "../theme";
import { themed } from "./themed";

// The motion layer.
//
// The application had none. Every control was either instant or an opacity fade,
// which is not a neutral choice: an interface that does not respond to a finger
// feels like a form, and an interface that responds *late* feels broken. A press
// that settles under the thumb is most of what separates a product that feels
// expensive from one that feels assembled, and it costs one spring.
//
// Two rules hold everything here together:
//
//   Motion is on the compositor, never on the JavaScript thread. Every animation
//   below moves `transform` or `opacity` through a shared value, so a list that is
//   mid-scroll does not drop the animation and the animation does not drop the
//   scroll.
//
//   Anybody who has asked their phone to stop animating gets no animation. Not a
//   shorter one. `useReducedMotion` reads the real system setting, and every hook
//   here returns a static style when it is on.

// A press that settles rather than snaps.
//
// The scale is deliberately small. A control that shrinks to 0.9 reads as a toy;
// 0.975 is felt rather than seen, which is the point. Opacity moves with it so the
// feedback survives on a surface where a scale of 2.5% is hard to perceive.
export function usePressMotion(enabled = true) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const live = enabled && !reduced;

  const onPressIn = useCallback(() => {
    if (live) pressed.value = withSpring(1, motion.press);
  }, [live, pressed]);

  const onPressOut = useCallback(() => {
    if (live) pressed.value = withSpring(0, motion.press);
  }, [live, pressed]);

  const style = useAnimatedStyle(() => {
    if (!live) return {};
    const t = pressed.value;
    return {
      transform: [{ scale: 1 - t * (1 - motion.pressScale) }],
      opacity: 1 - t * 0.12,
    };
  }, [live]);

  return { style, onPressIn, onPressOut };
}

// Content arriving. A short rise and a fade, staggered by position.
//
// The stagger is capped rather than multiplied without limit: a list of forty rows
// each delayed by another 40ms would take a second and a half to finish arriving,
// and the last row would appear to be broken. Past the eighth item everything lands
// together.
export function Enter({ children, index = 0, style }: {
  children: ReactNode;
  index?: number;
  style?: object;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
  const delay = Math.min(index, 8) * 45;
  return (
    <Animated.View
      // The width is not decoration.
      //
      // Reanimated runs an entering animation on the web by setting
      // `position: absolute` on the view. An absolutely positioned element with
      // no left or right shrinks to its own content — so this wrapper, which sits
      // around the contents of every screen in both applications, was collapsing
      // them to whatever the widest line happened to be. On a desktop that meant
      // every page rendering in about five hundred points of a twelve hundred
      // point window, with the rest blank: not a card that failed to stretch, but
      // the whole page.
      style={[styles.fill, style]}
      entering={FadeIn.duration(motion.slow)
        .delay(delay)
        .easing(Easing.out(Easing.cubic))
        .withInitialValues({ opacity: 0, transform: [{ translateY: motion.enterOffset }] })}
    >
      {children}
    </Animated.View>
  );
}

// A number that counts to its value rather than appearing at it.
//
// Used only where the number is the point: a dashboard tile, a wallet balance. On
// a row in a table it would be noise, and noise that delays the reading of the
// figure by half a second.
export function useCountUp(value: number, active = true) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(active && !reduced ? 0 : value);
  if (active && !reduced) {
    shown.value = withTiming(value, { duration: 600, easing: Easing.out(Easing.cubic) });
  } else {
    shown.value = value;
  }
  return shown;
}

const styles = StyleSheet.create({
  // Fills the container whether or not it is taken out of the flow.
  fill: { width: "100%" },
});

export { Animated };

// A placeholder that says a row is coming, not that something is wrong.
//
// A spinner over a table is a page that has stopped; a skeleton is a page that has
// started. It belongs where the shape of what is loading is already known — the
// staff tables, where every row has the same four columns — and nowhere else. A
// skeleton standing in for a single card reads as a card that failed to draw, which
// is why `Loading` still exists for that case.
//
// The sweep moves a translated block behind a clipped bar rather than animating a
// gradient position, because a gradient offset is a layout property and this has to
// stay on the compositor while the list it is inside is being scrolled.
export function Skeleton({ width = "100%", height = 11, style }: {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}) {
  const reduced = useReducedMotion();
  const slide = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    slide.value = withRepeat(
      withTiming(1, { duration: 1150, easing: Easing.linear }),
      -1,
      false,
    );
  }, [reduced, slide]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: (slide.value * 2 - 1) * 180 }],
  }));

  return (
    <View
      style={[skeletonStyles.bar, { width, height, borderRadius: height / 2 }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {reduced ? null : <Animated.View style={[skeletonStyles.sweep, sweep]} />}
    </View>
  );
}

// One row of a table, the shape the real rows will be.
export function SkeletonRow({ widths }: { widths: (number | `${number}%`)[] }) {
  return (
    <View style={skeletonStyles.row}>
      {widths.map((w, i) => (
        // eslint-disable-next-line react/no-array-index-key -- a column has no id
        <Skeleton key={i} width={w} />
      ))}
    </View>
  );
}

// A mark that breathes, for the one stage of an order that is happening now.
//
// Deliberately the only looping animation in either application. A screen with two
// things pulsing has nothing that reads as current; a screen with one has an answer
// to "where is my washing" that does not need a sentence.
export function Pulse({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduced || !active) { breath.value = 0; return; }
    breath.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [reduced, active, breath]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - breath.value * 0.45,
    transform: [{ scale: 1 + breath.value * 0.12 }],
  }));

  if (reduced || !active) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}

const skeletonStyles = themed((theme) => ({
  bar: { backgroundColor: theme.surface.sunken, overflow: "hidden" },
  sweep: {
    ...StyleSheet.absoluteFillObject,
    width: 90,
    backgroundColor: theme.line.subtle,
    opacity: 0.9,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.base, paddingVertical: space.snug },
}));
