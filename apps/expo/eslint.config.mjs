import expoConfig from "eslint-config-expo/flat.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: [".expo/**", "dist/**", "node_modules/**"] },
  ...expoConfig,
];
