import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

// The frost on a glass pane. Real backdrop blur is a web capability — react-native-web
// passes `backdrop-filter` through to CSS — so on the web build a translucent pane
// genuinely frosts what is behind it. A device has no equivalent without a native blur
// module, so there it returns nothing and the pane's own translucency carries the
// effect. Cast because React Native's style types predate the property.
//
// Kept out of theme.ts on purpose: the contrast verifier imports the token file in
// plain Node, where a runtime `react-native` import cannot resolve, so the one helper
// that needs `Platform` lives here instead.
export function glass(blurPx = 18): ViewStyle {
  if (Platform.OS !== "web") return {};
  return { backdropFilter: `blur(${blurPx}px)`, WebkitBackdropFilter: `blur(${blurPx}px)` } as unknown as ViewStyle;
}
