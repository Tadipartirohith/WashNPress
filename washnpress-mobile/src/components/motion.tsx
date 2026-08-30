import { useCallback, type ReactNode } from "react";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  Easing,
} from "react-native-reanimated";
import { motion } from "../theme";

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
  if (reduced) return <Animated.View style={style}>{children}</Animated.View>;
  const delay = Math.min(index, 8) * 45;
  return (
    <Animated.View
      style={style}
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

export { Animated };
