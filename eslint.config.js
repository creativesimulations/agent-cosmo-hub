import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "child_process", message: "Use systemAPI / IPC from electron main only." },
            { name: "node:child_process", message: "Use systemAPI / IPC from electron main only." },
            { name: "fs", message: "Use systemAPI (window.electronAPI) — never import fs in renderer." },
            { name: "node:fs", message: "Use systemAPI (window.electronAPI) — never import fs in renderer." },
            { name: "path", message: "Use systemAPI — never import path in renderer." },
            { name: "node:path", message: "Use systemAPI — never import path in renderer." },
            { name: "os", message: "Use systemAPI — never import os in renderer." },
            { name: "node:os", message: "Use systemAPI — never import os in renderer." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/]",
          message:
            "Use HSL CSS variables / Tailwind semantic tokens (e.g. border, muted) instead of raw hex in src.",
        },
      ],
    },
  },
);
