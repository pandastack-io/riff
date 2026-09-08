"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type Lenis from "lenis";
import type { Project } from "@/lib/types";
import { EXAMPLES, PromptComposer, ProjectCard, Logo, type FwChoice, type DataFile } from "@/components/riff-ui";

import { HeroDemo } from "@/components/landing/HeroDemo";

const REPO = "https://github.com/pandastack-io/riff";

export default function Landing() {
  const router = useRouter();
  const [framework, setFramework] = useState<FwChoice>("auto");
  const [projects, setProjects] = useState<Project[]>([]);
  const scope = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/projects"); const d = await r.json(); setProjects(d.projects || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const start = useCallback(async (prompt: string, fw: FwChoice, image?: string, data?: DataFile) => {
    const trimmed = prompt.trim();
    if (!trimmed && !image && !data) return;
    const r = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: (trimmed || "From a design").slice(0, 40), framework: fw }),
    });
    const p: Project = await r.json();
    try { sessionStorage.setItem(`riff:pending:${p.id}`, JSON.stringify({ prompt: trimmed, imageDataUrl: image, dataFile: data ? { name: data.name, text: data.text } : undefined })); } catch { /* ignore */ }
    router.push(`/project/${p.id}`);
  }, [router]);

  const deleteProject = useCallback(async (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); } catch { /* ignore */ }
    refresh();
  }, [refresh]);

  // Smooth scrolling + scroll-linked motion. Both are progressive enhancements:
  // if either import fails, or the visitor asked for reduced motion, the page is
  // simply a normal page — every section is already visible at rest.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let lenis: Lenis | null = null;
    let killed = false;
    const cleanups: (() => void)[] = [];

    (async () => {
      const [{ default: Lenis }, { gsap }, { ScrollTrigger }] = await Promise.all([
        import("lenis"), import("gsap"), import("gsap/ScrollTrigger"),
      ]);
      if (killed) return;
      gsap.registerPlugin(ScrollTrigger);

      const instance = new Lenis({ duration: 1.05, smoothWheel: true });
      lenis = instance;
      instance.on("scroll", ScrollTrigger.update);
      const ticker = (t: number) => instance.raf(t * 1000);
      gsap.ticker.add(ticker);
      gsap.ticker.lagSmoothing(0);
      cleanups.push(() => gsap.ticker.remove(ticker));

      const ctx = gsap.context(() => {
        // Sections rise into place. They start visible, so a failure here leaves
        // the page correct rather than blank.
        gsap.utils.toArray<HTMLElement>("[data-rise]").forEach((el) => {
          gsap.from(el, {
            y: 26, opacity: 0, duration: 0.75, ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

      }, scope);
      cleanups.push(() => ctx.revert());
    })();

    return () => {
      killed = true;
      cleanups.forEach((f) => f());
      lenis?.destroy();
    };
  }, []);

  const recent = projects.slice(0, 4);

  return (
    <div ref={scope} className="relative">
      <Nav />

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pb-24 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[680px] bg-[radial-gradient(46%_78%_at_22%_-4%,rgba(45,212,191,0.15),transparent)]" />
        <div className="relative mx-auto w-full max-w-[1180px]">
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-10">
            <div className="max-w-[620px]">
            <Badge />
            <h1 className="mt-6 font-[family-name:var(--font-display)] text-[46px] font-semibold leading-[0.98] tracking-[-0.03em] text-[var(--ink)] sm:text-[64px]" style={{ textWrap: "balance" }}>
              Prompt → a running app.
              <br />
              <span className="text-[var(--accent)]">Then fork it.</span>
            </h1>
            <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed text-[var(--muted)]">
              Describe an app and Riff builds it, then runs it live in a real Firecracker microVM.
              Fork the running app <em className="not-italic text-[var(--ink)]">and its Postgres</em> into
              parallel variations, compare them side by side, and keep the one you like.
            </p>

            <div className="mt-9">
              <PromptComposer framework={framework} setFramework={setFramework} onStart={start} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLES.slice(0, 3).map((e) => (
                <button key={e} onClick={() => start(e, framework)}
                  className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[12.5px] text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--ink)]">
                  {e}
                </button>
              ))}
            </div>

            </div>

            <HeroDemo className="lg:pt-3" />
          </div>

          <dl className="mt-14 grid max-w-[620px] grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              {[
                ["~100ms", "microVM boot"], ["~0.7s", "to fork a VM"],
                ["≈ $0", "idle, forever"], ["100%", "self-hostable"],
              ].map(([v, k]) => (
                <div key={k}>
                  <dt className="mono text-[19px] font-semibold text-[var(--ink)]">{v}</dt>
                  <dd className="mt-0.5 text-[12px] text-[var(--faint)]">{k}</dd>
                </div>
              ))}
          </dl>

          {recent.length > 0 && (
            <div className="mt-16 max-w-[640px]" data-rise>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Your projects</span>
                <span className="rounded-full bg-[var(--panel2)] px-1.5 text-[10.5px] text-[var(--faint)]">{projects.length}</span>
                {projects.length > recent.length && <Link href="/projects" className="ml-auto text-[12px] text-[var(--accent)] hover:underline">View all →</Link>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((p) => <ProjectCard key={p.id} p={p} onDelete={deleteProject} />)}
              </div>
            </div>
          )}
        </div>
      </section>

      <Understands />
      <Comparison />
      <HowItWorks />
      <Cta />
      <Footer />
    </div>
  );
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-[var(--line)]/70 bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2.5"><Logo /><span className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight">Riff</span></Link>
        <span className="ml-1 hidden rounded-md border border-[var(--line)] bg-[var(--panel2)] px-1.5 py-0.5 text-[10.5px] text-[var(--faint)] sm:inline">MIT · self-hostable</span>
        <div className="ml-auto flex items-center gap-2">
          <a href="#how" className="hidden rounded-lg px-3 py-1.5 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)] sm:block">How it works</a>
          <Link href="/projects" className="hidden rounded-lg px-3 py-1.5 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)] sm:block">Projects</Link>
          <a href={REPO} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/35 bg-[var(--accent-dim)]/15 px-3 py-1.5 text-[13px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-dim)]/25">
            <GitHubMark /> Star on GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}

function Badge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-[12px] text-[var(--muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" style={{ animation: "pulse 1.8s ease-in-out infinite" }} />
      Open-source Lovable / v0 / bolt — on your own hardware
    </span>
  );
}

function Section({ id, eyebrow, title, sub, children }: { id?: string; eyebrow: string; title: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-[var(--line)]/60 px-6 py-24">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="max-w-[62ch]" data-rise>
          <span className="mono text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">{eyebrow}</span>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] sm:text-[40px]" style={{ textWrap: "balance" }}>{title}</h2>
          {sub && <p className="mt-4 text-[16px] leading-relaxed text-[var(--muted)]">{sub}</p>}
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

// The moat, told as a scroll. Pinned and scrubbed, so the split happens under the
// reader's own thumb rather than on a loop they have to wait for.
// The new intent layer, sold as what it is: understanding you can see.
function Understands() {
  return (
    <Section
      eyebrow="Understands the ask"
      title={<>It tells you what it understood.<br />Before it writes a line.</>}
      sub="Every other builder resolves a vague prompt by asking you questions. Riff states what it assumed, builds the most likely reading, then offers to show you the others — running, side by side."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-rise>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--accent)]">Understood</span>
            <span className="text-[13.5px] font-semibold">Bakery Dashboard</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--muted)]">A dashboard for managing bakery operations and sales. <span className="text-[var(--faint)]">· for bakery owners and staff</span></p>
          <Field label="Assuming">
            <div className="flex flex-wrap gap-1.5">
              {["visual data, not tables ⇄", "no login ⇄", "real-time updates ⇄"].map((t) => (
                <span key={t} className="rounded-full border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-[11.5px] text-[var(--muted)]">{t}</span>
              ))}
            </div>
          </Field>
          <Field label="Checked">
            <ul className="flex flex-col gap-1 text-[12px]">
              {[
                [true, "total sales for the day are displayed"],
                [true, "low stock is clearly flagged"],
                [false, "a chart plots sales trends over time"],
                [true, "orders are listed with their status"],
              ].map(([ok, t]) => (
                <li key={String(t)} className="flex items-start gap-2">
                  <span className={`mt-px w-3 shrink-0 text-center ${ok ? "text-teal-300" : "text-rose-300"}`}>{ok ? "✓" : "✕"}</span>
                  <span className={ok ? "text-[var(--muted)]" : "text-[var(--ink)]"}>{t}</span>
                </li>
              ))}
            </ul>
          </Field>
          <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11.5px] text-[var(--faint)]">
            The failing check came back from the <em className="not-italic text-[var(--muted)]">running</em> app: the model
            had shipped a &ldquo;chart coming soon&rdquo; placeholder. Riff fixed it before saying done.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {[
            ["Assume and state, never interrogate", "Assumptions are chips you flip, not a form you fill. At most one question, and only when the answer changes the whole app."],
            ["When in doubt, show", "If a prompt reads two ways, Riff builds the likely one and offers the other as a live fork. Answering by looking beats answering in words."],
            ["“Live” should mean it works", "After the app is up, Riff screenshots it and checks each acceptance criterion. A blank page or a placeholder is a failure, not a success."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
              <h3 className="font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-tight">{t}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-2.5">
      <span className="w-[58px] shrink-0 pt-px text-[10.5px] uppercase tracking-wide text-[var(--faint)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Comparison() {
  const rows: [string, string, string][] = [
    ["Where generated code runs", "Browser sandbox or shared infra", "A real Firecracker microVM, KVM-isolated"],
    ["Database", "Managed for you, one per project", "Managed Postgres — and forks clone it"],
    ["Exploring alternatives", "One linear chat thread", "N live branches, side by side, keep one"],
    ["Idle previews", "Expire, or meter", "Scale to zero — ≈ $0, wakes in ~1s"],
    ["Where it runs", "Their cloud only", "Your own bare-metal box"],
    ["Licence", "Closed SaaS", "MIT, no lock-in"],
  ];
  return (
    <Section
      eyebrow="Why it exists"
      title="Everything the closed ones can't do."
      sub="Lovable, v0 and bolt are good products with the same four walls. Riff is the version you can run yourself."
    >
      <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)]" data-rise>
        <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--panel2)]">
              <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--faint)]">&nbsp;</th>
              <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--faint)]">Closed SaaS builders</th>
              <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">Riff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, them, us]) => (
              <tr key={k} className="border-b border-[var(--line2)] last:border-0">
                <td className="px-5 py-3.5 text-[var(--ink)]">{k}</td>
                <td className="px-5 py-3.5 text-[var(--faint)]">{them}</td>
                <td className="px-5 py-3.5 text-[var(--muted)]">{us}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function HowItWorks() {
  const steps: [string, string, string][] = [
    ["Understand", "A fast model writes the brief — jobs, screens, assumptions, and the checks the finished app must pass — while the microVM boots.", "~1s, in parallel"],
    ["Generate", "Codegen writes only app source. The build harness that binds the port is fixed, so untrusted output can never break the preview.", "OpenAI · Anthropic · keyless"],
    ["Run", "Files land on the VM, the dev server starts, and Riff polls the real preview host until it answers.", "live URL"],
    ["Check", "Riff screenshots the running app and judges it against the brief, feeding any miss back into the self-fix loop.", "then, done"],
  ];
  return (
    <Section id="how" eyebrow="How it works" title="The orchestrator never runs the generated code."
      sub="Riff drives the PandaStack API and nothing else — no eval, no shared process. Isolation is a KVM boundary, not a promise.">
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-rise>
        {steps.map(([t, d, meta], i) => (
          <li key={t} className="relative rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
            <span className="mono text-[11px] text-[var(--accent)]">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="mt-2 font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-tight">{t}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">{d}</p>
            <span className="mono mt-3 block text-[11px] text-[var(--faint)]">{meta}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Cta() {
  return (
    <section className="border-t border-[var(--line)]/60 px-6 py-28">
      <div className="relative mx-auto w-full max-w-[1180px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel)] px-8 py-16 text-center" data-rise>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(45,212,191,0.16),transparent)]" />
        <div className="relative">
          <h2 className="font-[family-name:var(--font-display)] text-[34px] font-semibold leading-tight tracking-[-0.025em] sm:text-[44px]" style={{ textWrap: "balance" }}>
            Run the whole thing on your own box.
          </h2>
          <p className="mx-auto mt-4 max-w-[56ch] text-[16px] leading-relaxed text-[var(--muted)]">
            Riff is the open-source builder. PandaStack is the compute layer. Point it at your own
            cluster and the apps, the databases and the forks never leave your hardware.
          </p>
          <div className="mx-auto mt-8 max-w-[620px] overflow-x-auto rounded-xl border border-[var(--line)] bg-[#0b0d10] p-4 text-left">
            <pre className="mono text-[12.5px] leading-relaxed text-[var(--muted)]"><code>{`git clone ${REPO} riff && cd riff
npm install
cp .env.local.example .env.local   # PANDASTACK_API_KEY + a model key
npm run dev                        # → http://localhost:4321`}</code></pre>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href={REPO} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[14px] font-semibold text-neutral-950 transition hover:bg-teal-300 active:scale-95">
              <GitHubMark /> Star Riff on GitHub
            </a>
            <a href="https://pandastack.ai" target="_blank" rel="noreferrer"
              className="rounded-xl border border-[var(--line)] bg-[var(--panel2)] px-5 py-2.5 text-[14px] text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--ink)]">
              About PandaStack ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--line)]/60 px-6 py-10">
      <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[var(--faint)]">
        <span className="flex items-center gap-2"><Logo /> Riff</span>
        <span>MIT licensed</span>
        <a className="hover:text-[var(--muted)]" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        <a className="hover:text-[var(--muted)]" href="https://pandastack.ai" target="_blank" rel="noreferrer">PandaStack</a>
        <span className="ml-auto">Built to be forked.</span>
      </div>
    </footer>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
