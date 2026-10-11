// Root ESLint flat config for the ClipHive pnpm + Turbo monorepo.
// Covers apps/* and packages/*. Run with `pnpm exec eslint .` from the repo root.
//
// Note: apps/web (Next.js 14) keeps its own `next lint` script (ESLint 8,
// eslintrc mode) — this flat config is for CI-wide coverage and the
// non-Next workspaces (apps/server, packages/*).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // Never lint build output, vendored code, or the Python ML service.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.vercel/**",
      "apps/ml/**",
      "**/*.sql",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Next.js / tooling config files are plain JS with CommonJS exports.
    files: [
      "**/next.config.{js,mjs,cjs}",
      "**/postcss.config.{js,mjs,cjs}",
      "**/tailwind.config.{js,ts}",
      "**/drizzle.config.{js,ts}",
      "**/modal_deploy.{js,ts}",
    ],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // apps/web is a Next.js 14 app linted primarily by `next lint`.
    // Keep the root flat-config pass lenient there to avoid duplicate
    // noise; workspace-level `next lint` is the source of truth.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  }
);
