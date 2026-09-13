import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";
import { colorScheme, illustration } from "../theme";
import { Decorative, useSceneClock } from "./illustrations";

// Rising bubbles, for the sign-in header only.
//
// The imagery board draws these on a canvas; here they are a handful of SVG circles
// moved by Reanimated, capped at eighteen so the field costs next to nothing. Every
// bubble rides one shared 16-second clock, rising one, two or three times per loop —
// small ones faster — so the loop closes without a visible jump. Under reduced motion,
// or with the app in the background, the clock is parked and the field is a still frame.

const MAX_BUBBLES = 18;
const LOOP_MS = 16000;
const TAU = Math.PI * 2;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Bubble = { x: number; start: number; r: number; laps: number; phase: number };
type Tone = { ring: string; fill: string; hi: string };

// The same layout on every render for a given size, from a fixed seed, rather than a
// field that reshuffles whenever the screen re-renders.
function layout(width: number, height: number): Bubble[] {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const count = Math.min(MAX_BUBBLES, Math.max(6, Math.round((26 * width * height) / 120000)));
  return Array.from({ length: count }, () => {
    const r = 3 + rand() ** 2.2 * 20;
    const laps = r < 8 ? 2 + Math.round(rand()) : 1 + Math.round(rand());
    return { x: rand() * width, start: rand(), r, laps, phase: rand() };
  });
}

// How far, in points, a bubble takes to fade in below the clear band.
const FADE_BAND = 28;

export function BubbleField({ onAction = false, clearAbove = 0 }: {
  // Drawn over a primary-coloured surface rather than the page ground.
  onAction?: boolean;
  // Text never sits among bubbles. Above this many points from the top of the field
  // no bubble is drawn: each one fades out as its top edge rises into the band.
  clearAbove?: number;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const clock = useSceneClock(true, LOOP_MS);
  const bubbles = useMemo(() => layout(box.width, box.height), [box.width, box.height]);
  const colours = illustration[colorScheme()];
  const tone = onAction ? colours.bubbleOnAction : colours.bubble;

  const measure = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== box.width || height !== box.height) setBox({ width, height });
  };

  return (
    <Decorative style={StyleSheet.absoluteFill}>
      <View style={StyleSheet.absoluteFill} onLayout={measure}>
        {box.width > 0 && box.height > 0 ? (
          <Svg width={box.width} height={box.height}>
            {bubbles.map((bubble, i) => (
              <BubbleShape key={i} bubble={bubble} height={box.height} clearAbove={clearAbove} tone={tone} t={clock.t} />
            ))}
          </Svg>
        ) : null}
      </View>
    </Decorative>
  );
}

function BubbleShape({ bubble, height, clearAbove, tone, t }: {
  bubble: Bubble; height: number; clearAbove: number; tone: Tone; t: SharedValue<number>;
}) {
  const { x, start, r, laps, phase } = bubble;
  const travel = height + 2 * r;
  // Up from below the bottom edge to above the top, with a slight side-to-side wobble,
  // fully transparent by the time its top edge reaches the clear band.
  const ring = useAnimatedProps(() => {
    const p = (((start - t.value * laps) % 1) + 1) % 1;
    const cy = p * travel - r;
    const opacity = Math.min(1, Math.max(0, (cy - r - clearAbove) / FADE_BAND));
    return { cy, cx: x + Math.sin((t.value * laps * 4 + phase) * TAU) * 3, opacity };
  }, [clearAbove]);
  const shine = useAnimatedProps(() => {
    const p = (((start - t.value * laps) % 1) + 1) % 1;
    const cy = p * travel - r;
    const opacity = Math.min(1, Math.max(0, (cy - r - clearAbove) / FADE_BAND));
    return { cy, cx: x + Math.sin((t.value * laps * 4 + phase) * TAU) * 3, opacity };
  }, [clearAbove]);
  // The highlight is a short arc on the upper left, drawn as a dash of a smaller circle.
  const inner = r * 0.62;

  return (
    <>
      <AnimatedCircle r={r} fill={tone.fill} stroke={tone.ring} strokeWidth={1.3} animatedProps={ring} />
      {r > 6 ? (
        <AnimatedCircle
          r={inner}
          fill="none"
          stroke={tone.hi}
          strokeWidth={1.6}
          strokeDasharray={`${0.9 * inner} ${TAU * inner}`}
          strokeDashoffset={-3.6 * inner}
          animatedProps={shine}
        />
      ) : null}
    </>
  );
}
