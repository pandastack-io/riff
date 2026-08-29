// Framework registry. Each framework owns a FIXED harness (scaffold) plus the
// contract the codegen model must follow. The model only ever writes the
// "app-source" files (src/**, app/**, or index.html) — never the harness that
// makes the dev server bind 0.0.0.0:PORT and accept the PandaStack preview host.
// That single invariant is what lets us run untrusted generated code without it
// breaking the preview.
import type { FileEntry, FrameworkId } from "./types";

export const APP_DIR = "/root/app";
export const APP_PORT = 3000;

export interface FrameworkSpec {
  id: FrameworkId;
  label: string;
  port: number;
  install: boolean;          // run a package install on a fresh sandbox?
  devCommand: string;        // launched under setsid in APP_DIR
  publicDir: string;         // dir under APP_DIR served at "/" (for generated image assets)
  scaffold(): FileEntry[];   // fixed harness written once per sandbox
  // ---- codegen contract ----
  codegenSystem: string;     // system prompt describing exactly what to emit
  entryFile: string;         // file that MUST be produced (validation)
  allowPath(path: string): boolean; // which paths the model may write
  dbNote: string;            // extra codegen guidance when a Postgres DB is attached
}

// Shared instruction: how the model asks Riff for real generated images.
const IMAGE_NOTE =
`\n\nImages: when you want a photo, illustration, avatar, texture, or hero image, reference it as \`/riff-gen/<short-kebab-description>.png\` (for example /riff-gen/snowy-mountain-at-dusk.png or /riff-gen/smiling-woman-portrait.png). Riff generates a real image at that exact path after your code is written. Use vivid, specific slugs. Do NOT use any other external image URLs, placeholder services, or base64 — only /riff-gen/*.png (or reference nothing and use CSS).`;

// ---------------------------------------------------------------------------
// vite-react — SPA, React 19 + Tailwind.
// ---------------------------------------------------------------------------
const viteReact: FrameworkSpec = {
  id: "vite-react",
  label: "React",
  port: APP_PORT,
  install: true,
  devCommand: "npm run dev",
  publicDir: "public",
  scaffold: () => [
    { path: "package.json", content: JSON.stringify({
        name: "riff-app", private: true, type: "module",
        scripts: { dev: `vite --host 0.0.0.0 --port ${APP_PORT}` },
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.4", vite: "^6.0.7",
          tailwindcss: "^3.4.17", postcss: "^8.4.49", autoprefixer: "^10.4.20",
        },
      }, null, 2) },
    { path: "vite.config.ts", content:
`import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: ${APP_PORT}, strictPort: true, allowedHosts: true, hmr: { clientPort: 443 } },
});
` },
    { path: "index.html", content:
`<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Riff App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
` },
    { path: "postcss.config.js", content: `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n` },
    { path: "tailwind.config.js", content:
`export default { content: ["./index.html", "./src/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] };\n` },
    { path: "src/main.tsx", content:
`import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
` },
    { path: "src/index.css", content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n` },
  ],
  codegenSystem:
`You are the code generator for Riff. You produce a Vite + React 19 + Tailwind CSS single-page app.

Hard rules:
- Output ONLY files under src/ (e.g. src/App.tsx, src/components/Foo.tsx, src/lib/x.ts). NEVER touch package.json, vite.config, index.html, tailwind/postcss config, or src/main.tsx — that harness is fixed.
- src/App.tsx MUST exist and export a default React component.
- Use ONLY react + react-dom + Tailwind utility classes. Do NOT import any other npm package.
- Write COMPLETE file contents (not diffs). Modern, accessible, genuinely polished UI. TypeScript.
- Self-contained and runnable. No TODOs, no placeholders, no external images that could 404.` + IMAGE_NOTE,
  entryFile: "src/App.tsx",
  allowPath: (p) => p.startsWith("src/") && p !== "src/main.tsx" && p !== "src/index.css" && !p.includes(".."),
  dbNote:
`A Postgres database is attached. For data access, call the Riff data API from the browser with fetch: POST /__riff/db/query { "sql": "…", "params": [...] } returns { "rows": [...] }. This endpoint is same-origin (served by the app's own proxy). Design any schema you need and create tables on first load (CREATE TABLE IF NOT EXISTS …).`,
};

// ---------------------------------------------------------------------------
// static — a single self-contained index.html. No build, no install: served by
// python's http.server, so it is the fastest possible path to a live URL.
// ---------------------------------------------------------------------------
const staticSite: FrameworkSpec = {
  id: "static",
  label: "Static",
  port: APP_PORT,
  install: false,
  devCommand: `python3 -m http.server ${APP_PORT} --bind 0.0.0.0`,
  publicDir: ".",
  scaffold: () => [], // the model produces index.html itself; nothing fixed
  codegenSystem:
`You are the code generator for Riff. You produce a fully self-contained STATIC website — no build step, no framework.

Hard rules:
- index.html MUST exist and be a complete HTML document. You MAY also emit styles.css and script.js (referenced with relative paths).
- All CSS is modern hand-written CSS (custom properties, fl/grid). Do NOT rely on any CDN, external font host, or external image URL — everything must work offline inside a sandbox. Inline SVG is fine.
- Vanilla JavaScript only (no frameworks, no bundler, no imports from URLs).
- Write COMPLETE file contents. Polished, responsive, accessible. No TODOs or placeholders.` + IMAGE_NOTE,
  entryFile: "index.html",
  allowPath: (p) => !p.startsWith("/") && !p.includes("..") && p.length > 0,
  dbNote:
`A Postgres database is attached. Query it from the browser with fetch: POST /__riff/db/query { "sql": "…", "params": [...] } → { "rows": [...] }. Create any tables you need with CREATE TABLE IF NOT EXISTS on load.`,
};

// ---------------------------------------------------------------------------
// next — Next.js 15 App Router (SSR/RSC). Real server, real routes.
// ---------------------------------------------------------------------------
const nextApp: FrameworkSpec = {
  id: "next",
  label: "Next.js",
  port: APP_PORT,
  install: true,
  devCommand: "npm run dev",
  publicDir: "public",
  scaffold: () => [
    { path: "package.json", content: JSON.stringify({
        name: "riff-app", private: true,
        scripts: { dev: `next dev -H 0.0.0.0 -p ${APP_PORT}` },
        dependencies: {
          next: "15.1.6", react: "19.0.0", "react-dom": "19.0.0",
        },
        devDependencies: {
          typescript: "^5.7.3", "@types/react": "^19.0.0", "@types/node": "^22.10.0",
          tailwindcss: "^3.4.17", postcss: "^8.4.49", autoprefixer: "^10.4.20",
        },
      }, null, 2) },
    // Next 15 blocks cross-origin dev asset requests unless the host is allowed;
    // the preview host is arbitrary, so allow all dev origins.
    { path: "next.config.js", content:
`/** @type {import('next').NextConfig} */
module.exports = { allowedDevOrigins: ["*"], eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } };
` },
    { path: "tsconfig.json", content: JSON.stringify({
        compilerOptions: {
          target: "ES2020", lib: ["dom", "dom.iterable", "esnext"], allowJs: true,
          skipLibCheck: true, strict: false, noEmit: true, esModuleInterop: true,
          module: "esnext", moduleResolution: "bundler", resolveJsonModule: true,
          isolatedModules: true, jsx: "preserve", incremental: true,
          plugins: [{ name: "next" }], paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      }, null, 2) },
    { path: "postcss.config.js", content: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n` },
    { path: "tailwind.config.js", content:
`module.exports = { content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] };\n` },
    { path: "app/layout.tsx", content:
`import "./globals.css";
export const metadata = { title: "Riff App" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
` },
    { path: "app/globals.css", content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n` },
  ],
  codegenSystem:
`You are the code generator for Riff. You produce a Next.js 15 App Router app (React 19, Tailwind CSS, TypeScript).

Hard rules:
- Output files under app/**, components/**, or lib/** only. NEVER touch package.json, next.config.js, tsconfig, tailwind/postcss config, app/layout.tsx, or app/globals.css — that harness is fixed.
- app/page.tsx MUST exist and export a default React component (the home route). Add more routes as app/<route>/page.tsx, server actions, and route handlers (app/api/*/route.ts) as needed.
- Use ONLY next, react, react-dom, and Tailwind utility classes. Do NOT import any other npm package.
- Write COMPLETE file contents (not diffs). Modern, accessible, polished UI. Prefer Server Components; add "use client" only where interactivity requires it.
- Self-contained and runnable. No TODOs, no placeholders, no external images that could 404.` + IMAGE_NOTE,
  entryFile: "app/page.tsx",
  allowPath: (p) =>
    (p.startsWith("app/") || p.startsWith("components/") || p.startsWith("lib/")) &&
    !p.includes("..") && p !== "app/layout.tsx" && p !== "app/globals.css",
  dbNote:
`A real Postgres database is attached. Do ALL data access on the SERVER (Server Components, route handlers app/api/*/route.ts, or server actions) — NEVER expose the connection to the client. The "pg" package is preinstalled. Use this exact pattern in a shared lib/db.ts:
    import { Pool } from "pg";
    export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
Then \`import { pool } from "@/lib/db"\` and \`await pool.query(sql, params)\`. Before first use, ensure your schema with CREATE TABLE IF NOT EXISTS (run it lazily inside the query path). Persist real data so it survives reloads. Mark data-fetching routes/pages dynamic (export const dynamic = "force-dynamic") so they always read fresh rows.`,
};

const REGISTRY: Record<FrameworkId, FrameworkSpec> = {
  "vite-react": viteReact,
  static: staticSite,
  next: nextApp,
};

export const FRAMEWORKS: FrameworkSpec[] = [viteReact, nextApp, staticSite];

export function frameworkFor(id: FrameworkId): FrameworkSpec {
  return REGISTRY[id] || viteReact;
}

// Heuristic framework pick from a free-text prompt (used when the user didn't pick).
export function detectFramework(prompt: string): FrameworkId {
  const p = prompt.toLowerCase();
  if (/\bnext(\.?js)?\b|\bserver component|\bssr\b|\bapp router\b|\broute handler/.test(p)) return "next";
  if (/\bstatic\b|\bplain html\b|\blanding page\b|\bsingle page of html\b/.test(p)) return "static";
  return "vite-react";
}
