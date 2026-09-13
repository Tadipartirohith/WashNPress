import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { Decorative, useSceneClock } from "./illustrations";

// The water edge where a tinted header meets the page.
//
// The imagery board's 800-unit wave, drawn twice the width of its container and slid
// left by half of that over seven seconds, so the edge flows without a seam. Placed at
// the bottom of a header whose parent is relatively positioned; `color` is whatever
// lies below, usually the page. Still unless `animated`, and still under reduced motion.

const WAVE = "M0 13 C30 1 100 25 150 13 S250 1 300 13 S370 25 400 13 S500 25 550 13 S650 1 700 13 S770 25 800 13 V26 H0Z";

export function WaveEdge({ color, height = 26, animated = false }: {
  color: string;
  height?: number;
  animated?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const clock = useSceneClock(animated, 7000);
  const flow = useAnimatedStyle(() => ({ transform: [{ translateX: -width * clock.t.value }] }), [width]);

  return (
    <Decorative style={[styles.edge, { height }]}>
      <View style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Animated.View style={[{ width: width * 2, height }, flow]}>
            <Svg width={width * 2} height={height} viewBox="0 0 800 26" preserveAspectRatio="none">
              <Path d={WAVE} fill={color} />
            </Svg>
          </Animated.View>
        ) : null}
      </View>
    </Decorative>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, bottom: -1, overflow: "hidden" },
});
