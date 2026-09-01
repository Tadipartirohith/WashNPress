import type { PressableStateCallbackType } from "react-native";

// The two interaction states that only exist when there is a pointer.
//
// `Pressable` reports `hovered` and `focused` on the web and neither on a handset,
// but React Native's own types describe only `pressed` — the extra fields come from
// react-native-web, and `PressableStateCallbackType` is a type alias rather than an
// interface, so it cannot be augmented from here. The cast is therefore unavoidable;
// keeping it in one named place is the difference between a documented platform fact
// and an `as any` scattered through the components.
//
// Both fields read as false on iOS and Android, so a component written against this
// gains a pointer affordance in the staff build and behaves exactly as before on a
// phone.

export interface PointerState {
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
}

export function pointer(state: PressableStateCallbackType): PointerState {
  const web = state as PressableStateCallbackType & { hovered?: boolean; focused?: boolean };
  return {
    pressed: web.pressed,
    hovered: Boolean(web.hovered),
    focused: Boolean(web.focused),
  };
}
