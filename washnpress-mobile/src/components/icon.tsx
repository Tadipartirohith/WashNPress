import {
  Check, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleCheck, Lock,
  Minus, Plus, Search, Square, SquareCheck, X,
} from "lucide-react-native";
import { size, theme } from "../theme";

// The icon set.
//
// There was no icon set. A tick was the character U+2713, a checkbox was U+2610 or
// U+2611, a close button was a multiplication sign and a locked conversation was
// the padlock emoji. Every one of those renders at whatever weight and baseline the
// device font happens to give it, which is why the tick in a wizard step sat two
// pixels higher than the tick in a batch list, and why the padlock arrived in full
// colour on one platform and as flat glyph on another.
//
// These are vectors on a 24 grid, drawn at one weight, taking their colour from
// whatever asks for them. Adding one means importing it here and naming it, so the
// set stays a set rather than becoming whatever each screen reached for.

const GLYPHS = {
  check: Check,
  checkCircle: CircleCheck,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  circle: Circle,
  checkbox: Square,
  checkboxOn: SquareCheck,
  lock: Lock,
  minus: Minus,
  plus: Plus,
  search: Search,
  close: X,
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size: pt = size.icon.md, color = theme.text.secondary, strokeWidth = 2 }: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Glyph = GLYPHS[name];
  // Decorative by default. An icon that repeats the label beside it is noise to a
  // screen reader, and every icon here has a label beside it or an
  // accessibilityLabel on the control that holds it.
  return <Glyph size={pt} color={color} strokeWidth={strokeWidth} />;
}
