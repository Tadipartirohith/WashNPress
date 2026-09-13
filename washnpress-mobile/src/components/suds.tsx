import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
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

export function Suds({ tint }: { tint: SudsTint }) {
  const colours = illustration[colorScheme()];
  const id = useSvgId("suds");
  return (
    <Decorative style={[StyleSheet.absoluteFill, { backgroundColor: colours.tint[tint] }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" x={0} y={0} width={120} height={120}>
            {RINGS.map(([cx, cy, r]) => (
              <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="none" stroke={colours.sud} strokeWidth={2} />
            ))}
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Decorative>
  );
}
