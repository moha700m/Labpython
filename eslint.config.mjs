import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "apps/desktop/dist/**", "**/.next/**", "**/out/**", "**/dist/**", "apps/web/public/**", "apps/web/next-env.d.ts", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["apps/web/**/*.tsx"], plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } },
  {
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", document: "readonly", window: "readonly", location: "readonly", localStorage: "readonly", navigator: "readonly", FormData: "readonly", Blob: "readonly", WebSocket: "readonly", performance: "readonly", getComputedStyle: "readonly", ResizeObserver: "readonly", atob: "readonly", btoa: "readonly", DOMException: "readonly", TextEncoder: "readonly", confirm: "readonly", prompt: "readonly", HTMLInputElement: "readonly", HTMLDivElement: "readonly", HTMLImageElement: "readonly", KeyboardEvent: "readonly", BeforeUnloadEvent: "readonly", File: "readonly", FileList: "readonly", AbortSignal: "readonly", BodyInit: "readonly", Headers: "readonly", NodeJS: "readonly", React: "readonly" } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-control-regex": "off",
    },
  },
);
