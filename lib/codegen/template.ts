import type { CodegenProvider, CodegenResult, CodegenRequest } from "./index";

// Deterministic, no-LLM generator. It produces a genuinely polished starter for
// whichever framework the project uses, so the whole pipeline (sandbox → files →
// install → dev server → live preview) is testable without any API key. Set
// OPENAI_API_KEY or ANTHROPIC_API_KEY to swap in real AI generation.
function titleFrom(prompt: string): string {
  const cleaned = prompt.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter((w) => w.length > 2 &&
    !/^(the|and|for|with|that|make|build|create|app|a|an|to|me|my|please|website|site)$/i.test(w));
  const t = words.slice(0, 3).join(" ");
  return t ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : "Your App";
}

const reactComponent = (title: string, sub: string) => `import { useState } from "react";

const features = [
  { t: "Runs for real", d: "This page is served by a live dev server inside a Firecracker microVM — not a browser sandbox." },
  { t: "Live in ~1 second", d: "The VM booted from a memory snapshot, then the dev server started serving instantly." },
  { t: "Yours to fork", d: "Riff can fork this whole running app to try variations side by side." },
];

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased selection:bg-teal-500/30">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_120%_at_50%_-10%,rgba(45,212,191,0.16),transparent)]" />
      <main className="relative mx-auto max-w-4xl px-6 py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-teal-300">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" /> live preview
        </span>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">${title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-neutral-400">${sub.replace(/"/g, '\\"')}</p>
        <div className="mt-8 flex items-center gap-4">
          <button onClick={() => setCount((c) => c + 1)}
            className="rounded-xl bg-teal-500 px-5 py-2.5 font-medium text-neutral-950 shadow-lg shadow-teal-500/20 transition hover:bg-teal-400 active:scale-95">
            Clicked {count} {count === 1 ? "time" : "times"}
          </button>
          <span className="text-sm text-neutral-500">state is real — this is a running React app</span>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-teal-500/30 hover:bg-white/[0.05]">
              <div className="text-sm font-semibold text-neutral-100">{f.t}</div>
              <div className="mt-2 text-sm leading-relaxed text-neutral-400">{f.d}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
`;

const staticDoc = (title: string, sub: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 16px/1.6 system-ui, sans-serif; background:#0a0a0a; color:#e5e5e5; }
  main { max-width: 56rem; margin: 0 auto; padding: 6rem 1.5rem; }
  .pill { display:inline-flex; gap:.5rem; align-items:center; border:1px solid #ffffff1a; background:#ffffff0d; color:#2dd4bf; padding:.25rem .75rem; border-radius:999px; font-size:.75rem; }
  h1 { margin-top:1.5rem; font-size:3.5rem; letter-spacing:-.02em; }
  p { margin-top:1.25rem; max-width:42rem; color:#a3a3a3; font-size:1.125rem; }
  .grid { margin-top:4rem; display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }
  .card { border:1px solid #ffffff1a; background:#ffffff08; padding:1.25rem; border-radius:1rem; }
  .card b { display:block; }
  .card span { color:#a3a3a3; font-size:.9rem; }
</style>
</head>
<body>
  <main>
    <span class="pill">● live preview</span>
    <h1>${title}</h1>
    <p>${sub.replace(/</g, "&lt;")}</p>
    <div class="grid">
      <div class="card"><b>Runs for real</b><span>Served by a live server inside a Firecracker microVM.</span></div>
      <div class="card"><b>Live in ~1 second</b><span>The VM boots from a memory snapshot.</span></div>
      <div class="card"><b>Yours to fork</b><span>Riff can fork the whole running app.</span></div>
    </div>
  </main>
</body>
</html>
`;

export const templateProvider: CodegenProvider = {
  name: "template",
  async generate(req: CodegenRequest): Promise<CodegenResult> {
    const title = titleFrom(req.prompt);
    const sub = req.prompt.trim().slice(0, 120) || "Built with Riff on a PandaStack microVM.";
    const fw = req.framework.id;
    let file: { path: string; content: string };
    if (fw === "static") file = { path: "index.html", content: staticDoc(title, sub) };
    else if (fw === "next") file = { path: "app/page.tsx", content: `"use client";\n` + reactComponent(title, sub) };
    else file = { path: "src/App.tsx", content: reactComponent(title, sub) };
    return {
      summary: `Generated a polished “${title}” starter (${req.framework.label}). Set OPENAI_API_KEY or ANTHROPIC_API_KEY for full AI generation.`,
      files: [file],
    };
  },
};
