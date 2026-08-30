module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated's worklet transform. It has to be the last plugin in the list,
    // which is why it is written out rather than left implicit.
    plugins: ["react-native-reanimated/plugin"],
  };
};
