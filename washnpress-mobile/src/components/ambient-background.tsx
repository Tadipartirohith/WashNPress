import { useEffect, useState } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Ellipse } from "react-native-svg";
import { backgroundGradient, glowBlobs } from "../theme";
import { appearanceChoice, onAppearanceChange, type Appearance } from "../appearance";

// The ground every screen floats on.
//
// A glass pane only reads as glass if there is something with depth behind it to
// refract. This paints that: a soft vertical aurora wash for the whole viewport, with
// two large blurred colour pools floated over it — the brand jade and a cool indigo —
// so the translucent cards above have light and colour to sit in rather than a flat
// fill. It is painted once, absolutely positioned behind the app, and never takes a
// touch. Drawn with react-native-svg so the same file works on a device and on the
// web build with no platform code.
export function AmbientBackground() {
  const { width, height } = useWindowDimensions();
  // Re-render when the person switches light/dark, so the ground changes with the
  // panes above it rather than being left on yesterday's mode.
  const [scheme, setScheme] = useState<Appearance>(appearanceChoice());
  useEffect(() => onAppearanceChange(setScheme), []);

  // Coerce to a concrete mode so a stray appearance value can never index the maps
  // with something they do not hold.
  const mode = scheme === "dark" ? "dark" : "light";
  const stops = backgroundGradient[mode];
  const blobs = glowBlobs[mode];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="aurora" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={stops[0]} />
            <Stop offset="0.55" stopColor={stops[1]} />
            <Stop offset="1" stopColor={stops[2]} />
          </LinearGradient>
          <RadialGradient id="blobBrand" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blobs.brand} stopOpacity={1} />
            <Stop offset="1" stopColor={blobs.brand} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="blobAccent" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blobs.accent} stopOpacity={1} />
            <Stop offset="1" stopColor={blobs.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#aurora)" />
        {/* Top-right brand pool and a lower-left indigo pool. Wide and shallow so
            they read as ambient light rather than as two circles. */}
        <Ellipse cx={width * 0.84} cy={height * 0.1} rx={width * 0.72} ry={height * 0.26} fill="url(#blobBrand)" />
        <Ellipse cx={width * 0.08} cy={height * 0.82} rx={width * 0.78} ry={height * 0.3} fill="url(#blobAccent)" />
      </Svg>
    </View>
  );
}
