// Expo's default Metro config (monorepo-aware), plus .wasm assets for expo-sqlite on web.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
