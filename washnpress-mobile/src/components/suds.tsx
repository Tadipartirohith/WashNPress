import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Pattern, Rect, Stop } from "react-native-svg";
import { colorScheme, illustration } from "../theme";
import { Decorative, useSvgId } from "./illustrations";

// The suds pattern: a service tint with a tile of soap rings over it.
//
// The imagery board's 120-point tile, five rings at its positions and sizes, as an SVG
// pattern. Still: it fills the space behind a header or a thumbnail and never moves,
// so it adds nothing for reduced motion to switch off. It fills whatever it is placed
// in, so the parent sets the size and clips the corners.

export type SudsTint = "laundry" | "iron" | "car";

// Centre x, centre y and radius of each ring in the 120-point tile.
const RINGS: readonly (readonly [number, number, number])[] = [
  [18, 22, 8], [64, 60, 12], [98, 18, 5], [32, 98, 6], [104, 100, 9],
];

export function Suds({ tint, fadeLeft = 0 }: {
  tint: SudsTint;
  // Points over which the rings fade in from the left edge, for a patch of suds that
  // sits beside plain tint rather than filling a whole header.
  fadeLeft?: number;
}) {
  const colours = illustration[colorScheme()];
  const ground = colours.tint[tint];
  const id = useSvgId("suds");
  return (
    <Decorative style={[StyleSheet.absoluteFill, { backgroundColor: ground }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" x={0} y={0} width={120} height={120}>
            {RINGS.map(([cx, cy, r]) => (
              <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="none" stroke={colours.sud} strokeWidth={2} />
            ))}
          </Pattern>
          {fadeLeft > 0 ? (
            <LinearGradient id={`${id}fade`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={ground} stopOpacity={1} />
              <Stop offset="1" stopColor={ground} stopOpacity={0} />
            </LinearGradient>
          ) : null}
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
        {fadeLeft > 0 ? <Rect x={0} y={0} width={fadeLeft} height="100%" fill={`url(#${id}fade)`} /> : null}
      </Svg>
    </Decorative>
  );
}
