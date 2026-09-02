import { StyleSheet } from "react-native";
import { colorScheme, themes, type Theme } from "../theme";

// A stylesheet that knows about both modes.
//
// `StyleSheet.create` runs once, when the module loads, and copies the colours it is
// given into the sheet. That is the whole reason a fully authored dark palette could
// sit in the theme for months with no effect: every screen resolved against light
// before the first render and never looked again.
//
// The usual fix is to turn all twenty-eight stylesheets into hooks, which means every
// component reading `styles.card` changes as well. This builds one sheet per mode up
// front and hands back a proxy that picks between them when a style is read — so a
// screen keeps saying `styles.card` and gets the right card. Two sheets of under a
// hundred values each is a few kilobytes.
//
// The factory's parameter is named `theme` at every call site on purpose: it shadows
// the live export of the same name, which is what allowed this to be applied to the
// existing stylesheets without editing a single line inside them.
export function themed<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T): T {
  const sheets = {
    light: StyleSheet.create(factory(themes.light)),
    dark: StyleSheet.create(factory(themes.dark)),
  };
  return new Proxy({} as T, {
    get: (_target, key) => sheets[colorScheme()][key as keyof T],
    has: (_target, key) => key in sheets.light,
    ownKeys: () => Reflect.ownKeys(sheets.light),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}
