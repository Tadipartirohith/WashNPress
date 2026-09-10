module.exports = function (api) {
  api.cache(true);
  return {
    // The worklet transform is not listed here on purpose.
    //
    // It used to be, as `react-native-reanimated/plugin`, because it has to run last
    // and writing it out was the only way to be sure it did. Reanimated 4 moved the
    // transform into `react-native-worklets`, and `babel-preset-expo` now resolves
    // and appends that plugin itself whenever the package is installed (see
    // babel-preset-expo/build/configs/expo.js). Naming it again would run the
    // transform twice over every worklet.
    //
    // If worklets ever need to be turned off, it is a preset option —
    // `["babel-preset-expo", { worklets: false }]` — rather than a plugin to remove.
    presets: ["babel-preset-expo"],
  };
};
