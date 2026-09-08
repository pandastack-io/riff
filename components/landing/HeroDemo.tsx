"use client";
import { useEffect, useRef } from "react";

// The hero is the product, caught mid-build: the prompt on the left, the Brief
// Riff wrote from it, the build steps ticking over, and the finished app on the
// right. An abstract graphic would say "AI tool"; this says what Riff actually
// does, and doubles as the screenshot.
//
// The markup IS the finished state. GSAP only replays how it got there, so with
// no JavaScript, a failed import, or reduced motion, the hero still reads.

const STEPS = [
  ["◇", "Booting a fresh microVM…", "boot 94ms", "muted"],
  ["◎", "Understood — Bakery Dashboard", "4 checks to pass", "accent"],
  ["✎", "Wrote src/App.tsx +4 more", "", "muted"],
  ["☑", "Matches the brief — 4/4 checks pass", "", "accent"],
  ["✓", "Live in 0.5s", "3000-7a74230c.pandastack.ai", "ok"],
] as const;

const TONE: Record<string, string> = {
  muted: "text-[var(--muted)]", accent: "text-[var(--accent)]", ok: "text-teal-300",
};

export function HeroDemo({ className = "" }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let killed = false;
    let ctxRevert: (() => void) | null = null;

    (async () => {
      const { gsap } = await import("gsap");
      if (killed || !root.current) return;
      const ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from("[data-d='window']", { y: 18, opacity: 0, duration: 0.7 })
          .from("[data-d='prompt']", { y: 8, opacity: 0, duration: 0.4 }, 0.25)
          .from("[data-d='brief']", { y: 10, opacity: 0, duration: 0.5 }, 0.5)
          .from("[data-d='chip']", { y: 6, opacity: 0, stagger: 0.07, duration: 0.35 }, 0.7)
          .from("[data-d='check']", { opacity: 0, x: -6, stagger: 0.09, duration: 0.3 }, 0.95)
          .from("[data-d='step']", { opacity: 0, x: -8, stagger: 0.13, duration: 0.35 }, 1.15)
          .from("[data-d='preview']", { opacity: 0, scale: 0.97, duration: 0.6 }, 1.0)
          .from("[data-d='tile']", { y: 10, opacity: 0, stagger: 0.08, duration: 0.4 }, 1.3)
          .from("[data-d='bar']", { scaleY: 0, transformOrigin: "bottom", stagger: 0.05, duration: 0.45 }, 1.55)
          .from("[data-d='row']", { opacity: 0, x: 8, stagger: 0.07, duration: 0.35 }, 1.7);
      }, root);
      ctxRevert = () => ctx.revert();
    })();

    return () => { killed = true; ctxRevert?.(); };
  }, []);

  return (
    <div ref={root} className={className}>
      <div data-d="window" className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel2)] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2f38]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2f38]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2f38]" />
          <span className="mono ml-2 truncate text-[10.5px] text-[var(--faint)]">riff · a dashboard for my bakery</span>
          <span className="mono ml-auto flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-300">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" style={{ animation: "pulse 1.8s ease-in-out infinite" }} /> live
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
          {/* left: the ask, the Brief, the build */}
          <div className="flex flex-col gap-2.5 border-b border-[var(--line)] p-3.5 sm:border-b-0 sm:border-r">
            <div data-d="prompt" className="ml-auto max-w-[86%] rounded-2xl rounded-br-md border border-teal-400/25 bg-[var(--accent-dim)]/45 px-3 py-1.5 text-[11.5px] text-teal-50">
              a dashboard for my bakery
            </div>

            <div data-d="brief" className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--accent)]">Understood</span>
                <span className="text-[11.5px] font-semibold text-[var(--ink)]">Bakery Dashboard</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {["visual, not tables ⇄", "no login ⇄", "live totals ⇄"].map((t) => (
                  <span key={t} data-d="chip" className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-1.5 py-0.5 text-[9.5px] text-[var(--muted)]">{t}</span>
                ))}
              </div>
              <ul className="mt-2 flex flex-col gap-0.5">
                {["today's takings are shown", "low stock is flagged", "a chart plots the week", "orders show their status"].map((t) => (
                  <li key={t} data-d="check" className="flex items-start gap-1.5 text-[10px] leading-snug text-[var(--muted)]">
                    <span className="text-teal-300">✓</span>{t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-1 pt-0.5">
              {STEPS.map(([icon, label, detail, tone]) => (
                <div key={label} data-d="step" className="flex items-start gap-2">
                  <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-[8.5px] ${TONE[tone]}`}>{icon}</span>
                  <span className="min-w-0">
                    <span className={`block text-[10.5px] leading-snug ${TONE[tone]}`}>{label}</span>
                    {detail && <span className="mono block truncate text-[9px] text-[var(--faint)]">{detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* right: the app that came out */}
          <div data-d="preview" className="bg-[#0d1014] p-3">
            <div className="flex h-full flex-col gap-2.5 rounded-lg border border-[var(--line2)] bg-[#0f1319] p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-[var(--ink)]">Rise &amp; Crumb</span>
                <span className="mono text-[9px] text-[var(--faint)]">today</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[["£1,284", "takings"], ["37", "orders"], ["2", "low stock"]].map(([v, k]) => (
                  <div key={k} data-d="tile" className="rounded-md border border-[var(--line2)] bg-[#141922] px-2 py-1.5">
                    <div className="mono text-[11.5px] font-semibold text-[var(--accent)]">{v}</div>
                    <div className="text-[8.5px] text-[var(--faint)]">{k}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-[var(--line2)] bg-[#141922] p-2">
                <div className="mb-1.5 text-[8.5px] uppercase tracking-wider text-[var(--faint)]">Sales this week</div>
                <div className="flex h-[52px] items-end gap-1.5">
                  {[42, 58, 35, 71, 64, 88, 76].map((h, i) => (
                    <div key={i} data-d="bar" className="flex-1 rounded-sm bg-[var(--accent)]" style={{ height: `${h}%`, opacity: 0.35 + i * 0.09 }} />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                {[["Sourdough ×12", "ready"], ["Croissants ×24", "baking"], ["Focaccia ×6", "pending"]].map(([item, state], i) => (
                  <div key={item} data-d="row" className="flex items-center gap-2 rounded-md border border-[var(--line2)] bg-[#141922] px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-[9.5px] text-[var(--muted)]">{item}</span>
                    <span className={`mono rounded-full px-1.5 py-0.5 text-[8px] ${i === 0 ? "bg-teal-400/12 text-teal-300" : i === 1 ? "bg-amber-400/12 text-amber-300" : "bg-white/5 text-[var(--faint)]"}`}>{state}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroDemo;
