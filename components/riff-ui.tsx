"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import type { Project, FrameworkId, Branch, ProjectStatus } from "@/lib/types";
import { StatusPill, Spinner } from "@/components/ui";

export const EXAMPLES = [
  "A sleek landing page for a coffee subscription",
  "A pomodoro timer with a circular progress ring",
  "A markdown note-taking app with a sidebar",
  "A pricing page with a monthly/yearly toggle",
];

export type FwChoice = "auto" | FrameworkId;
export const FRAMEWORK_CHOICES: { id: FwChoice; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "vite-react", label: "React" },
  { id: "next", label: "Next.js" },
  { id: "static", label: "Static" },
];
export const FW_LABEL: Record<FrameworkId, string> = { "vite-react": "React", next: "Next.js", static: "Static" };

export const BRANCH_LENSES = [
  "Redesign it BOLD and maximalist: oversized type, saturated color, dramatic high contrast, big expressive blocks.",
  "Redesign it MINIMAL and refined: airy whitespace, hairline borders, a near-monochrome palette, elegant small type.",
  "Redesign it PLAYFUL: rounded shapes, bright friendly colors, chunky buttons, bouncy hover and interaction animations.",
  "Redesign it EDITORIAL: serif display headings, a magazine-style grid, dramatic spacing, a two-color palette.",
];

const ACCENTS = [
  { name: "Teal", hex: "#2dd4bf" }, { name: "Indigo", hex: "#6366f1" }, { name: "Violet", hex: "#8b5cf6" },
  { name: "Rose", hex: "#f43f5e" }, { name: "Amber", hex: "#f59e0b" }, { name: "Emerald", hex: "#10b981" },
  { name: "Sky", hex: "#0ea5e9" }, { name: "Mono", hex: "#111111" },
];
const STYLES = [
  { id: "minimal", label: "Minimal", desc: "clean and airy, lots of whitespace, hairline borders, refined typography, restrained color" },
  { id: "playful", label: "Playful", desc: "friendly and colorful, generous rounded corners, bouncy hover micro-interactions, big cheerful type" },
  { id: "glassy", label: "Glassy", desc: "glassmorphism — translucent blurred cards, soft gradients, subtle glow, layered depth" },
  { id: "brutalist", label: "Brutalist", desc: "neo-brutalist — thick black borders, hard offset shadows, high contrast, monospace accents, raw blocks" },
  { id: "editorial", label: "Editorial", desc: "magazine-like — strong serif display headings, elegant spacing, a considered two-color palette" },
];

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export async function fileToDataUrl(file: File, max = 1600, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 900_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch { return dataUrl; }
}

function mapToStatus(s: Branch["status"]): ProjectStatus {
  switch (s) {
    case "spawning": case "cloning-db": return "booting";
    case "generating": return "generating";
    case "starting": return "starting";
    case "checking": return "checking";
    case "live": case "kept": return "live";
    default: return "error";
  }
}
function humanizeBranch(b: Branch): string {
  switch (b.status) {
    case "spawning": return "Forking the running app…";
    case "cloning-db": return "Cloning the database…";
    case "generating": return "Generating this variation…";
    case "starting": return "Starting the dev server…";
    case "checking": return "Waiting for it to serve…";
    case "error": return b.error ? b.error.slice(-200) : "This variation didn't come up";
    default: return "Working…";
  }
}

export function Logo() {
  return <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)] text-[13px] font-bold text-neutral-950">R</span>;
}
export function Dot() { return <span className="h-3 w-3 rounded-full border border-[var(--line)]" />; }

// A single "prompt" composer used on the home page (with image attach + framework picker).
export function PromptComposer({ framework, setFramework, onStart, autoFocus = true }: {
  framework: FwChoice; setFramework: (f: FwChoice) => void; onStart: (s: string, f: FwChoice, image?: string) => void; autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => { if (f) setImage(await fileToDataUrl(f)); };
  const go = () => onStart(input, framework, image || undefined);
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }}>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-2 shadow-2xl shadow-black/40 transition focus-within:border-[var(--accent)]/40">
        {image && (
          <div className="flex items-center gap-2 px-2 pt-1">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="reference" className="h-14 w-14 rounded-lg border border-[var(--line)] object-cover" />
              <button type="button" onClick={() => setImage(null)} className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-neutral-800 text-[10px] text-neutral-300 ring-1 ring-black/40 hover:text-white">✕</button>
            </div>
            <span className="text-[12px] text-[var(--muted)]">Cloning this design</span>
          </div>
        )}
        <textarea
          autoFocus={autoFocus} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }}
          rows={3} placeholder={image ? "Anything to change about the design? (optional)" : "Build me a…"}
          className="focus-ring w-full resize-none bg-transparent px-3 py-2.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" onClick={() => fileRef.current?.click()} title="Attach a screenshot to clone"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-[var(--panel2)] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--ink)]">🖼</button>
            <FrameworkPicker value={framework} onChange={setFramework} />
          </div>
          <button type="submit" className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-teal-300 active:scale-95">{image ? "Clone it" : "Build it"}</button>
        </div>
      </div>
    </form>
  );
}

function FrameworkPicker({ value, onChange }: { value: FwChoice; onChange: (f: FwChoice) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-0.5">
      {FRAMEWORK_CHOICES.map((c) => (
        <button key={c.id} type="button" onClick={() => onChange(c.id)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition ${value === c.id ? "bg-[var(--accent)] text-neutral-950" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function ProjectCard({ p, onDelete }: { p: Project; onDelete: (id: string) => void }) {
  return (
    <div className="group relative flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 transition hover:border-[var(--accent)]/30">
      <Link href={`/project/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`h-2 w-2 shrink-0 rounded-full ${p.status === "live" ? "bg-teal-400" : p.status === "error" ? "bg-rose-400" : "bg-neutral-500"}`} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] text-[var(--ink)]">{p.name}</span>
          <span className="mono block truncate text-[11px] text-[var(--faint)]">{FW_LABEL[p.framework]} · {timeAgo(p.updatedAt)}{p.database ? " · Postgres" : ""}{p.checkpoints?.length ? ` · v${p.checkpoints.length}` : ""}</span>
        </span>
      </Link>
      <button onClick={() => { if (confirm(`Delete "${p.name}" and tear down its microVM${p.database ? " + database" : ""}?`)) onDelete(p.id); }} title="Delete project + its cloud resources"
        className="shrink-0 rounded-md px-1.5 py-1 text-[13px] text-[var(--faint)] opacity-0 transition hover:text-rose-300 group-hover:opacity-100">✕</button>
    </div>
  );
}

export function TopBar({ project, onAddDatabase, dbBusy, onOpenTheme, themeOpen, onOpenBranch, branchOpen, canBranch, onExport, ghBusy }: {
  project: Project; onAddDatabase: () => void; dbBusy: boolean; onOpenTheme: () => void; themeOpen: boolean; onOpenBranch: () => void; branchOpen: boolean; canBranch: boolean; onExport: () => void; ghBusy: boolean;
}) {
  const db = project.database;
  return (
    <header className="flex h-12 items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4">
      <Link href="/" className="flex items-center gap-2"><Logo /> <span className="text-sm font-semibold tracking-tight">Riff</span></Link>
      <span className="text-[var(--faint)]">/</span>
      <Link href="/projects" className="text-sm text-[var(--faint)] hover:text-[var(--muted)]">projects</Link>
      <span className="text-[var(--faint)]">/</span>
      <span className="truncate text-sm text-[var(--muted)]">{project.name}</span>
      <span className="rounded-md border border-[var(--line)] bg-[var(--panel2)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--muted)]">{FW_LABEL[project.framework]}</span>
      {db ? (
        <span className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--panel2)] px-1.5 py-0.5 text-[10.5px] font-medium text-sky-300" title={db.status}>
          <span className={`h-1.5 w-1.5 rounded-full ${db.status === "running" ? "bg-sky-400" : "bg-amber-400 animate-pulse"}`} />
          {db.status === "running" ? "Postgres" : "Provisioning DB…"}
        </span>
      ) : (
        <button onClick={onAddDatabase} disabled={dbBusy || !!project.activeRoundId}
          className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--panel2)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--muted)] transition hover:border-sky-400/40 hover:text-sky-300 disabled:opacity-50">
          {dbBusy ? <Spinner className="!h-2.5 !w-2.5" /> : "＋"} Postgres
        </button>
      )}
      <div className="ml-auto flex items-center gap-3">
        {project.previewUrl && (
          <a href={project.previewUrl} target="_blank" rel="noreferrer" className="mono max-w-[240px] truncate text-[11px] text-[var(--faint)] hover:text-[var(--muted)]">{project.previewUrl.replace("https://", "")}</a>
        )}
        <StatusPill status={project.status} />
        <button onClick={onOpenBranch} disabled={!canBranch} title="Fork this running app into live variations"
          className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-40 ${branchOpen ? "border-[var(--accent)]/40 bg-[var(--accent-dim)]/20 text-[var(--accent)]" : "border-[var(--accent)]/30 bg-[var(--accent-dim)]/10 text-[var(--accent)] hover:bg-[var(--accent-dim)]/20"}`}>⑂ Branch</button>
        <button onClick={onOpenTheme} className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${themeOpen ? "border-[var(--accent)]/40 bg-[var(--accent-dim)]/20 text-[var(--accent)]" : "border-[var(--line)] bg-[var(--panel2)] text-[var(--muted)] hover:border-[var(--accent)]/30 hover:text-[var(--ink)]"}`}>🎨 Theme</button>
        <button onClick={onExport} disabled={ghBusy} className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--ink)] disabled:opacity-50">{ghBusy ? <Spinner className="!h-2.5 !w-2.5" /> : "⑂"} GitHub</button>
        <Link href="/" className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--ink)]">＋ New</Link>
      </div>
    </header>
  );
}

export function ThemePanel({ busy, onApply, onClose }: { busy: boolean; onApply: (directive: string) => void; onClose: () => void }) {
  const [accent, setAccent] = useState(ACCENTS[0]);
  const [style, setStyle] = useState(STYLES[0]);
  const [dark, setDark] = useState(true);
  const apply = () => {
    const directive =
      `Restyle the app with a new visual theme. Use ${accent.name} (${accent.hex}) as the primary accent color, ` +
      `a ${dark ? "dark" : "light"} background, and a ${style.label} aesthetic: ${style.desc}. ` +
      `Keep ALL existing functionality, content, and layout structure exactly the same — change only colors, typography, spacing, corner radius, shadows, and component styling to fully commit to this look.`;
    onApply(directive);
  };
  return (
    <div className="absolute right-3 top-14 z-30 w-[300px] rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-2xl shadow-black/50">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Theme</span>
        <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--ink)]">✕</button>
      </div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Accent</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {ACCENTS.map((a) => (
          <button key={a.hex} onClick={() => setAccent(a)} title={a.name}
            className={`h-7 w-7 rounded-full ring-2 transition ${accent.hex === a.hex ? "ring-white/70 scale-110" : "ring-transparent hover:ring-white/20"}`}
            style={{ backgroundColor: a.hex }} />
        ))}
      </div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Style</div>
      <div className="mb-4 grid grid-cols-2 gap-1.5">
        {STYLES.map((s) => (
          <button key={s.id} onClick={() => setStyle(s)} title={s.desc}
            className={`rounded-lg border px-2 py-1.5 text-[12px] font-medium transition ${style.id === s.id ? "border-[var(--accent)]/50 bg-[var(--accent-dim)]/20 text-[var(--ink)]" : "border-[var(--line)] bg-[var(--panel2)] text-[var(--muted)] hover:text-[var(--ink)]"}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Mode</span>
        <div className="flex gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-0.5">
          {[["Dark", true], ["Light", false]].map(([label, v]) => (
            <button key={String(v)} onClick={() => setDark(v as boolean)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${dark === v ? "bg-[var(--accent)] text-neutral-950" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <button onClick={apply} disabled={busy}
        className="w-full rounded-lg bg-[var(--accent)] py-2 text-[13px] font-medium text-neutral-950 transition hover:bg-teal-300 disabled:opacity-40 active:scale-95">
        Apply theme
      </button>
    </div>
  );
}

export function Versions({ project, busy, onRestore }: { project: Project; busy: boolean; onRestore: (id: string) => void }) {
  const cps = project.checkpoints || [];
  if (cps.length < 2) return null;
  const latest = cps[cps.length - 1];
  return (
    <div className="border-t border-[var(--line)] px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Versions</span>
        <span className="text-[10.5px] text-[var(--faint)]">time-travel — restores app state</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {cps.slice().reverse().map((c) => {
          const isLatest = c.id === latest.id;
          return (
            <button key={c.id} disabled={busy || isLatest} onClick={() => onRestore(c.id)} title={c.message}
              className={`group shrink-0 rounded-lg border px-2.5 py-1.5 text-left transition ${isLatest
                ? "border-[var(--accent)]/40 bg-[var(--accent-dim)]/20"
                : "border-[var(--line)] bg-[var(--panel2)] hover:border-[var(--accent)]/30 disabled:opacity-40"}`}>
              <div className="flex items-center gap-1.5">
                <span className={`mono text-[11.5px] font-semibold ${isLatest ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}>{c.label}</span>
                {isLatest && <span className="text-[9.5px] text-[var(--accent)]">current</span>}
              </div>
              <div className="mono mt-0.5 max-w-[130px] truncate text-[10px] text-[var(--faint)]">{c.message}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Composer({ value, setValue, onSend, busy, placeholder }: { value: string; setValue: (s: string) => void; onSend: (s: string) => void; busy: boolean; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSend(value); }} className="border-t border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel2)] p-2 transition focus-within:border-[var(--accent)]/40">
        <textarea value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(value); } }}
          rows={1} placeholder={placeholder} disabled={busy}
          className="focus-ring max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] placeholder:text-[var(--faint)] focus:outline-none disabled:opacity-50" />
        <button type="submit" disabled={busy || !value.trim()}
          className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-neutral-950 transition hover:bg-teal-300 disabled:opacity-30 active:scale-95">
          {busy ? <Spinner /> : "↑"}
        </button>
      </div>
    </form>
  );
}

export function PreviewFrame({ project, busy, iframeKey, onRefresh }: { project: Project; busy: boolean; iframeKey: number; onRefresh: () => void }) {
  const url = project.previewUrl;
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex gap-1.5 pl-1"><Dot /><Dot /><Dot /></div>
        <div className="mono flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[11.5px] text-[var(--faint)]">
          {url ? url.replace("https://", "") : "waiting for preview…"}
        </div>
        <button onClick={onRefresh} disabled={!url} title="Reload" className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-30">⟳</button>
        {url && <a href={url} target="_blank" rel="noreferrer" title="Open" className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] transition hover:text-[var(--ink)]">↗</a>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-white">
        {url && project.status === "live"
          ? <iframe key={iframeKey} src={url} className="h-full w-full border-0" title="preview" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          : <BuildingOverlay project={project} busy={busy} />}
      </div>
    </div>
  );
}

function BuildingOverlay({ project, busy }: { project: Project; busy: boolean }) {
  const err = project.status === "error";
  return (
    <div className="grid h-full place-items-center bg-[var(--bg)]">
      <div className="text-center">
        {err ? (
          <>
            <div className="text-3xl">✕</div>
            <div className="mt-3 text-sm text-rose-300">Build failed</div>
            <div className="mono mx-auto mt-2 max-w-md truncate text-[11px] text-[var(--faint)]">{project.error}</div>
          </>
        ) : busy || project.status !== "new" ? (
          <>
            <Spinner className="!h-6 !w-6 text-[var(--accent)]" />
            <div className="mt-4 text-sm text-[var(--muted)]">{project.status === "booting" ? "Waking your app…" : "Building your app…"}</div>
            <div className="mono mt-1 text-[11px] text-[var(--faint)]">a live microVM is spinning up your preview</div>
          </>
        ) : (
          <div className="text-sm text-[var(--faint)]">Describe an app to begin.</div>
        )}
      </div>
    </div>
  );
}

export function BranchPanel({ busy, lastPrompt, onExplore, onClose }: { busy: boolean; lastPrompt: string; onExplore: (base: string, directives: string[]) => void; onClose: () => void }) {
  const [count, setCount] = useState(3);
  const [base, setBase] = useState(lastPrompt);
  const [dirs, setDirs] = useState<string[]>(BRANCH_LENSES.slice(0, 3));
  const setCountAndDirs = (n: number) => {
    setCount(n);
    setDirs((cur) => Array.from({ length: n }, (_, i) => cur[i] ?? BRANCH_LENSES[i] ?? BRANCH_LENSES[0]));
  };
  const explore = () => {
    const directives = dirs.map((d) => d.trim()).filter(Boolean).map((d) => base.trim() ? `${d} The app is a ${base.trim()}.` : d);
    onExplore(base.trim(), directives);
  };
  return (
    <div className="absolute right-3 top-14 z-30 w-[340px] rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-2xl shadow-black/50">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] font-semibold">⑂ Branch to explore</span>
        <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--ink)]">✕</button>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-[var(--faint)]">Fork the running app into live variations — each a real microVM. Compare side-by-side, keep the winner.</p>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Base</div>
      <textarea value={base} onChange={(e) => setBase(e.target.value)} rows={2}
        className="focus-ring mb-3 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1.5 text-[12.5px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none"
        placeholder="What the app is (kept across all variations)…" />
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--faint)]">Variations</span>
        <div className="flex gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-0.5">
          {[2, 3, 4].map((n) => (
            <button key={n} onClick={() => setCountAndDirs(n)}
              className={`rounded-md px-2.5 py-0.5 text-[12px] transition ${count === n ? "bg-[var(--accent)] text-neutral-950" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{n}</button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-col gap-1.5">
        {dirs.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel2)] text-[11px] font-semibold text-[var(--accent)]">{String.fromCharCode(65 + i)}</span>
            <input value={d} onChange={(e) => setDirs((cur) => cur.map((x, j) => j === i ? e.target.value : x))}
              className="focus-ring min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1.5 text-[12px] text-[var(--ink)] focus:outline-none" />
          </div>
        ))}
      </div>
      <button onClick={explore} disabled={busy || dirs.filter((d) => d.trim()).length < 2}
        className="w-full rounded-lg bg-[var(--accent)] py-2 text-[13px] font-medium text-neutral-950 transition hover:bg-teal-300 disabled:opacity-40 active:scale-95">
        {busy ? "Forking…" : `Explore ${count} variations →`}
      </button>
    </div>
  );
}

export function CompareGrid({ project, busy, onKeep, onDiscard, onKeepTrunk }: { project: Project; busy: boolean; onKeep: (id: string) => void; onDiscard: () => void; onKeepTrunk?: () => void }) {
  const branches = (project.branches || []).filter((b) => b.roundId === project.activeRoundId);
  const liveCount = branches.filter((b) => b.status === "live").length;
  // A round started from the Brief is answering a question, so the app that was
  // already there is one of the answers — offer it as a choice, not just an escape.
  const round = (project.rounds || []).find((r) => r.id === project.activeRoundId);
  const resolving = !!round?.ambiguityId;
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[13px] font-semibold text-[var(--ink)]">{resolving ? "Which did you mean?" : `Comparing ${branches.length} variations`}</span>
        <span className="text-[11.5px] text-[var(--faint)]">{liveCount}/{branches.length} live — pick a winner</span>
        <div className="ml-auto flex items-center gap-2">
          {resolving && onKeepTrunk && (
            <button onClick={onKeepTrunk} disabled={busy} title="Go back to the app you already had"
              className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--ink)] disabled:opacity-40">Keep the original</button>
          )}
          <button onClick={onDiscard} disabled={busy} className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-40">Discard all</button>
        </div>
      </div>
      <div className={`grid min-h-0 flex-1 gap-3 ${branches.length <= 1 ? "grid-cols-1" : "grid-cols-2"} ${branches.length > 2 ? "grid-rows-2" : "grid-rows-1"}`}>
        {branches.map((b) => <BranchCard key={b.id} b={b} busy={busy} onKeep={onKeep} />)}
      </div>
    </div>
  );
}

function BranchCard({ b, busy, onKeep }: { b: Branch; busy: boolean; onKeep: (id: string) => void }) {
  const live = b.status === "live" && !!b.previewUrl;
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-2.5 py-1.5">
        <span className="mono grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-bold text-neutral-950">{b.label}</span>
        {/* For a Brief-driven round the caption is the INTERPRETATION, not the raw directive. */}
        <span className="truncate text-[11.5px] text-[var(--muted)]" title={b.directive}>{b.readingLabel || b.directive.replace(/^.*?—\s*/, "")}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusPill status={mapToStatus(b.status)} />
          {live && <a href={b.previewUrl!} target="_blank" rel="noreferrer" title="Open" className="grid h-6 w-6 place-items-center rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]">↗</a>}
          <button onClick={() => onKeep(b.id)} disabled={!live || busy}
            className="rounded-md bg-[var(--accent)] px-2 py-1 text-[11.5px] font-medium text-neutral-950 transition hover:bg-teal-300 disabled:opacity-30 active:scale-95">Keep this</button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {live
          ? <iframe key={b.id} src={b.previewUrl!} className="h-full w-full border-0" title={`branch ${b.label}`} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" />
          : <div className="grid h-full place-items-center bg-[var(--bg)] p-4">
              <div className="text-center">
                {b.status === "error" ? <div className="text-2xl">✕</div> : <Spinner className="!h-5 !w-5 text-[var(--accent)]" />}
                <div className={`mt-3 text-[12px] ${b.status === "error" ? "text-rose-300" : "text-[var(--muted)]"}`}>{humanizeBranch(b)}</div>
              </div>
            </div>}
      </div>
    </div>
  );
}
