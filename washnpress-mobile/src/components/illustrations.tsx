import { useEffect, useId, useState, type ReactNode } from "react";
import { AppState, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, Line, Path, Rect } from "react-native-svg";
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withTiming, type SharedValue,
} from "react-native-reanimated";
import { colorScheme, illustration } from "../theme";

// The three service scenes — a washer, a steam iron and a car being washed — drawn
// from the approved imagery board in its own geometry and colours.
//
// They are decoration, always. Every one sits beside a label that already says what
// the service is, so a scene is hidden from screen readers on both platforms and never
// takes a touch; it must never add a word to anything's accessible name.
//
// Motion belongs to the large scenes only, and only when a caller asks for it with
// `animated`. A thumbnail or an empty state is the still frame. Anything that moves is
// a View transform or a numeric SVG attribute rather than an SVG transform, because
// those two run the same on a device and on the web build.

export type SceneName = "washer" | "iron" | "car";
type SceneProps = { size?: number; animated?: boolean };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const TAU = Math.PI * 2;
const layer: ViewStyle = { position: "absolute", left: 0, top: 0 };

// A repeating 0→1 clock for one motion.
//
// Parked at 0, which is each scene's still frame, whenever the scene was not asked to
// move, the device asks for reduced motion, or the app is not in the foreground — on
// the web that includes a hidden tab, which is how react-native-web reports it.
export function useSceneClock(animated: boolean, duration: number): { t: SharedValue<number>; live: boolean } {
  const reduced = useReducedMotion();
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
  useEffect(() => {
    if (!animated) return;
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, [animated]);

  const live = animated && !reduced && foreground;
  const t = useSharedValue(0);
  useEffect(() => {
    if (!live) { cancelAnimation(t); t.value = 0; return; }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [live, duration, t]);
  return { t, live };
}

// An id an SVG can reference. Ids share one document on the web, and React's own have
// colons in them, which `url(#…)` does not accept.
export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^A-Za-z0-9]/g, "")}`;
}

// Hidden from assistive technology on iOS, Android and the web, and inert to touch.
export function Decorative({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <View
      style={style}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      aria-hidden
    >
      {children}
    </View>
  );
}

function strokes(ink: string, width = 3) {
  return { stroke: ink, strokeWidth: width, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
}

// ------------------------------------------------------------------- the washer

export function Washer({ size = 120, animated = false }: SceneProps) {
  const c = illustration[colorScheme()];
  const s = size / 240;
  const spin = useSceneClock(animated, 7000);
  const sway = useSceneClock(animated, 3200);
  const bob = useSceneClock(animated, 3000);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.t.value * 360}deg` }] }));
  const swayStyle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.sin(sway.t.value * TAU) * 7 * s }] }), [s]);
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * (1 - Math.cos(bob.t.value * TAU)) * s }] }), [s]);
  const ink = strokes(c.ink);
  const box = { width: size, height: size };
  // The drum window, as a round clipping view: the clothes turn inside it and the
  // water sways inside it while the window itself stays put.
  const drum: ViewStyle = {
    position: "absolute", left: 77 * s, top: 102 * s, width: 86 * s, height: 86 * s,
    borderRadius: 43 * s, overflow: "hidden", backgroundColor: c.glass,
  };
  const drumBox = "77 102 86 86";

  return (
    <Decorative style={box}>
      <Svg width={size} height={size} viewBox="0 0 240 240" style={layer}>
        <Ellipse cx={120} cy={224} rx={80} ry={8} fill={c.shadow} />
        <Rect x={48} y={30} width={144} height={188} rx={18} fill={c.body} {...ink} />
        <Line x1={48} y1={74} x2={192} y2={74} fill="none" {...ink} />
        <Rect x={62} y={45} width={48} height={16} rx={8} fill={c.metal} />
        <Circle cx={156} cy={53} r={9} fill={c.metal} {...ink} />
        <Circle cx={177} cy={53} r={4.5} fill={c.water2} />
        <Circle cx={120} cy={145} r={55} fill={c.metal} {...ink} />
      </Svg>
      <View style={drum}>
        <Animated.View style={[layer, { width: 86 * s, height: 86 * s }, spinStyle]}>
          <Svg width={86 * s} height={86 * s} viewBox={drumBox}>
            <Rect x={92} y={112} width={34} height={18} rx={9} fill={c.shirt} stroke={c.ink} strokeWidth={2} />
            <Circle cx={146} cy={128} r={9} fill={c.water2} stroke={c.ink} strokeWidth={2} />
            <Rect x={112} y={160} width={26} height={14} rx={7} fill={c.foam} stroke={c.ink} strokeWidth={2} />
          </Svg>
        </Animated.View>
        <Animated.View style={[layer, { left: -14 * s, width: 114 * s, height: 86 * s }, swayStyle]}>
          <Svg width={114 * s} height={86 * s} viewBox="63 102 114 86">
            <Path d="M50 152 Q70 140 90 152 T130 152 T170 152 T210 152 V200 H50Z" fill={c.water1} opacity={0.85} />
            <Path d="M50 162 Q70 152 90 162 T130 162 T170 162 T210 162 V200 H50Z" fill={c.water2} opacity={0.9} />
          </Svg>
        </Animated.View>
        <Svg width={86 * s} height={86 * s} viewBox={drumBox} style={layer}>
          <Path d="M94 118 A34 34 0 0 1 120 107" fill="none" stroke={c.foam} strokeWidth={5} strokeLinecap="round" opacity={0.9} />
        </Svg>
      </View>
      <Svg width={size} height={size} viewBox="0 0 240 240" style={layer}>
        <Circle cx={120} cy={145} r={43} fill="none" {...ink} />
        <Circle cx={24} cy={66} r={5} fill="none" stroke={c.water2} strokeWidth={2.5} />
        <Circle cx={214} cy={116} r={4.5} fill="none" stroke={c.water2} strokeWidth={2.5} />
      </Svg>
      <Animated.View style={[layer, box, bobStyle]}>
        <Svg width={size} height={size} viewBox="0 0 240 240">
          <Circle cx={200} cy={36} r={14} fill={c.foam} stroke={c.ink} strokeWidth={2.5} />
          <Circle cx={195} cy={31} r={3.5} fill={c.water2} opacity={0.6} />
          <Circle cx={219} cy={72} r={8} fill={c.foam} stroke={c.ink} strokeWidth={2.5} />
          <Circle cx={30} cy={104} r={10} fill={c.foam} stroke={c.ink} strokeWidth={2.5} />
        </Svg>
      </Animated.View>
    </Decorative>
  );
}

// --------------------------------------------------------------------- the iron

// One wisp of steam: rises and fades on a 2.6s cycle, offset so the three take turns.
// The still frame keeps each wisp at its own fixed strength.
function useSteam(clock: { t: SharedValue<number>; live: boolean }, delay: number, still: number, s: number) {
  return useAnimatedStyle(() => {
    if (!clock.live) return { opacity: still, transform: [{ translateY: 0 }] };
    const p = (clock.t.value - delay + 1) % 1;
    const opacity = p < 0.4 ? 0.25 + (0.75 * p) / 0.4 : 1 - (0.8 * (p - 0.4)) / 0.6;
    return { opacity, transform: [{ translateY: (6 - 16 * p) * s }] };
  }, [clock.live, delay, still, s]);
}

const STEAM = [
  { d: "M88 84 C80 72 96 64 88 50", delay: 0, still: 0.8 },
  { d: "M70 92 C62 80 78 72 70 58", delay: 0.7 / 2.6, still: 0.6 },
  { d: "M106 76 C98 64 114 56 106 42", delay: 1.4 / 2.6, still: 0.7 },
];

export function Iron({ size = 120, animated = false }: SceneProps) {
  const c = illustration[colorScheme()];
  const s = size / 240;
  const clock = useSceneClock(animated, 2600);
  const puffs = [
    useSteam(clock, STEAM[0].delay, STEAM[0].still, s),
    useSteam(clock, STEAM[1].delay, STEAM[1].still, s),
    useSteam(clock, STEAM[2].delay, STEAM[2].still, s),
  ];
  const ink = strokes(c.ink);
  const box = { width: size, height: size };
  const handle = "M112 98 C112 72 124 64 144 64 L184 64 C193 64 197 71 195 79 L190 98";

  return (
    <Decorative style={box}>
      <Svg width={size} height={size} viewBox="0 0 240 240" style={layer}>
        <Ellipse cx={120} cy={222} rx={92} ry={8} fill={c.shadow} />
        <Rect x={34} y={156} width={172} height={58} rx={10} fill={c.shirt} {...ink} />
        <Path d="M100 156 L120 178 L140 156" fill={c.foam} {...ink} />
        <Circle cx={120} cy={192} r={3.5} fill={c.ink} />
        <Circle cx={120} cy={205} r={3.5} fill={c.ink} />
        <Path d={handle} fill="none" stroke={c.ink} strokeWidth={11} strokeLinecap="round" />
        <Path d={handle} fill="none" stroke={c.car} strokeWidth={5} strokeLinecap="round" />
        <Path d="M60 152 C64 116 94 98 134 98 L192 98 C200 98 206 104 206 112 L206 152 Z" fill={c.car} {...ink} />
        <Rect x={54} y={148} width={158} height={11} rx={5.5} fill={c.metal} {...ink} />
        <Circle cx={156} cy={124} r={10} fill={c.foam} {...ink} />
        <Line x1={156} y1={124} x2={156} y2={117} fill="none" stroke={c.ink} strokeWidth={2.5} strokeLinecap="round" />
        <Path d="M190 170 L193 178 L201 181 L193 184 L190 192 L187 184 L179 181 L187 178Z" fill={c.spark} />
      </Svg>
      {STEAM.map((wisp, i) => (
        <Animated.View key={wisp.d} style={[layer, box, puffs[i]]}>
          <Svg width={size} height={size} viewBox="0 0 240 240">
            <Path d={wisp.d} fill="none" stroke={c.steam} strokeWidth={4} strokeLinecap="round" />
          </Svg>
        </Animated.View>
      ))}
    </Decorative>
  );
}

// ---------------------------------------------------------------------- the car

// A wide scene: its height is five-sevenths of its width.
export function Car({ size = 140, animated = false }: SceneProps) {
  const c = illustration[colorScheme()];
  const s = size / 280;
  const height = 200 * s;
  const spray = useSceneClock(animated, 1100);
  const bob = useSceneClock(animated, 3000);
  const sprayProps = useAnimatedProps(() => ({ strokeDashoffset: -38 * spray.t.value }));
  const sprayProps2 = useAnimatedProps(() => ({ strokeDashoffset: -38 * spray.t.value }));
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * (1 - Math.cos(bob.t.value * TAU)) * s }] }), [s]);
  const ink = strokes(c.ink);
  const thin = { stroke: c.ink, strokeWidth: 2.5, strokeLinejoin: "round" as const };
  const water = { fill: "none", stroke: c.water2, strokeWidth: 4, strokeLinecap: "round" as const, strokeDasharray: "10 9" };
  const box = { width: size, height };
  const foam = { fill: c.foam, stroke: c.ink, strokeWidth: 2.5 };

  return (
    <Decorative style={box}>
      <Svg width={size} height={height} viewBox="0 0 280 200" style={layer}>
        <Ellipse cx={146} cy={176} rx={118} ry={7} fill={c.shadow} />
        <AnimatedPath d="M8 30 Q58 16 96 58" {...water} animatedProps={sprayProps} />
        <AnimatedPath d="M8 46 Q50 40 80 76" {...water} opacity={0.7} animatedProps={sprayProps2} />
        <Rect x={0} y={24} width={14} height={28} rx={5} fill={c.metal} {...ink} />
        <Path
          d="M32 150 V128 C32 118 40 112 50 110 L88 104 L116 80 C122 75 130 72 138 72 L200 72 C210 72 218 76 224 84 L244 106 L256 110 C266 113 270 120 270 130 V150 C270 154 266 158 262 158 H40 C36 158 32 154 32 150Z"
          fill={c.car}
          {...ink}
        />
        <Path d="M100 104 L122 84 C126 81 131 80 136 80 H164 V104Z" fill={c.glass} {...thin} />
        <Path d="M172 80 H198 C205 80 211 83 215 89 L228 104 H172Z" fill={c.glass} {...thin} />
        <Line x1={168} y1={106} x2={168} y2={150} fill="none" stroke={c.ink} strokeWidth={2.5} />
        <Rect x={178} y={114} width={14} height={4} rx={2} fill={c.ink} />
        <Rect x={254} y={118} width={12} height={8} rx={3} fill={c.spark} />
        <Circle cx={82} cy={156} r={20} fill={c.tyre} />
        <Circle cx={82} cy={156} r={8} fill={c.metal} />
        <Circle cx={218} cy={156} r={20} fill={c.tyre} />
        <Circle cx={218} cy={156} r={8} fill={c.metal} />
      </Svg>
      <Animated.View style={[layer, box, bobStyle]}>
        <Svg width={size} height={height} viewBox="0 0 280 200">
          <Circle cx={134} cy={68} r={12} {...foam} />
          <Circle cx={154} cy={62} r={15} {...foam} />
          <Circle cx={176} cy={66} r={12} {...foam} />
          <Circle cx={194} cy={70} r={8} {...foam} />
          <Circle cx={240} cy={100} r={9} {...foam} />
          <Circle cx={54} cy={112} r={7} {...foam} />
        </Svg>
      </Animated.View>
      <Svg width={size} height={height} viewBox="0 0 280 200" style={layer}>
        <Circle cx={112} cy={46} r={3.5} fill={c.water2} />
        <Circle cx={100} cy={30} r={2.5} fill={c.water2} />
        <Path d="M44 76 L47 83 L54 86 L47 89 L44 96 L41 89 L34 86 L41 83Z" fill={c.spark} />
        <Path d="M262 64 L264 69 L269 71 L264 73 L262 78 L260 73 L255 71 L260 69Z" fill={c.spark} />
      </Svg>
    </Decorative>
  );
}

// One entry point for a caller that picks the scene from data.
export function Scene({ name, ...props }: SceneProps & { name: SceneName }) {
  if (name === "iron") return <Iron {...props} />;
  if (name === "car") return <Car {...props} />;
  return <Washer {...props} />;
}
