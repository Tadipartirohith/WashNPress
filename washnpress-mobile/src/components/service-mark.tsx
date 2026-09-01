import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { theme, size } from "../theme";

// A mark for each service line, drawn rather than borrowed.
//
// The icon set covers verbs — a truck, a clock, a check — and has nothing that says
// "this is the washing one and that is the car one". Four rows in a service list are
// scanned by shape before a word is read, so the shape has to be the service.
//
// They are deliberately monochrome. The obvious move is a colour per line, and it
// collides on the first screen that matters: amber already means needs attention and
// red means failed, so an amber ironing badge beside an amber warning pill teaches an
// operator to stop trusting the colour. Form carries the service; the semantic ramp
// keeps its meaning.
//
// One 48x48 grid, one stroke width, one cap style across all three, and every
// structural stroke takes the colour it is given — so a mark inverts for dark mode
// without a second asset.

export type ServiceMarkName = "wash" | "iron" | "vehicle";

const STROKE = 1.8;

export function ServiceMark({ name, size: px = size.icon.lg, color = theme.text.primary }: {
  name: ServiceMarkName;
  size?: number;
  color?: string;
}) {
  const common = {
    stroke: color,
    strokeWidth: STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <Svg width={px} height={px} viewBox="0 0 48 48">
      {name === "wash" ? (
        <G {...common}>
          <Rect x={8} y={6} width={32} height={36} rx={7} />
          <Circle cx={24} cy={27} r={10.5} />
          {/* The two dials on the fascia, which is what stops the drum reading as a
              plain window. */}
          <Circle cx={14.5} cy={11.5} r={1.3} fill={color} stroke="none" />
          <Circle cx={20} cy={11.5} r={1.3} fill={color} stroke="none" />
          <Circle cx={24} cy={21} r={2.4} />
          <Circle cx={19.2} cy={30.5} r={1.8} />
          <Circle cx={29} cy={30} r={2} />
        </G>
      ) : null}

      {name === "iron" ? (
        <G {...common}>
          {/* Steam first, so it sits behind the body of the iron. */}
          <Path d="M17 15c0-2.2 2.4-2.4 2.4-4.6" />
          <Path d="M24 13c0-2.4 2.4-2.6 2.4-5" />
          <Path d="M31 15c0-2.2 2.4-2.4 2.4-4.6" />
          <Path d="M8 33h32c0-9.4-6.3-14.5-14.6-14.5H16C11.6 18.5 8 22.1 8 26.5z" />
          <Path d="M25.4 18.5v-3.2c0-1.9 1.5-3.3 3.3-3.3H35" />
          <Line x1={6} y1={37.5} x2={42} y2={37.5} />
        </G>
      ) : null}

      {name === "vehicle" ? (
        <G {...common}>
          <Path d="M9 32.5v-5l3.2-8.4c.7-1.8 2.3-3 4.2-3h15.2c1.9 0 3.5 1.2 4.2 3L39 27.5v5z" />
          <Path d="M12.6 26.5h22.8" />
          {/* Water falling onto the roof. Three strokes, because a wash that is not
              being washed is just a parked car. */}
          <Line x1={16} y1={13} x2={16} y2={17} />
          <Line x1={24} y1={11.5} x2={24} y2={16} />
          <Line x1={32} y1={13} x2={32} y2={17} />
          <Circle cx={15} cy={34} r={3.2} />
          <Circle cx={33} cy={34} r={3.2} />
          <Line x1={5} y1={38.5} x2={43} y2={38.5} />
        </G>
      ) : null}
    </Svg>
  );
}
