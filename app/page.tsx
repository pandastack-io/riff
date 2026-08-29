"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Project } from "@/lib/types";
import { EXAMPLES, FRAMEWORK_CHOICES, type FwChoice, PromptComposer, ProjectCard, Logo } from "@/components/riff-ui";

export default function Home() {
  const router = useRouter();
  const [framework, setFramework] = useState<FwChoice>("auto");
  const [projects, setProjects] = useState<Project[]>([]);

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/projects"); const d = await r.json(); setProjects(d.projects || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Create the project, stash the first prompt, and hand off to /project/[id],
  // which runs the build and shows it live.
  const start = useCallback(async (prompt: string, fw: FwChoice, image?: string) => {
    const trimmed = prompt.trim();
    if (!trimmed && !image) return;
    const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: (trimmed || "From a design").slice(0, 40), framework: fw }) });
    const p: Project = await r.json();
    try { sessionStorage.setItem(`riff:pending:${p.id}`, JSON.stringify({ prompt: trimmed, imageDataUrl: image })); } catch { /* ignore */ }
    router.push(`/project/${p.id}`);
  }, [router]);

  const deleteProject = useCallback(async (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); } catch { /* ignore */ }
    refresh();
  }, [refresh]);

  const recent = projects.slice(0, 6);

  return (
    <div className="relative min-h-screen overflow-y-auto px-6 py-[12vh]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(50%_100%_at_50%_-10%,rgba(45,212,191,0.12),transparent)]" />
      <div className="relative mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo /> <span className="text-lg font-semibold tracking-tight">Riff</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-[44px]" style={{ textWrap: "balance" as const }}>
          Prompt → a running app.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          Describe it, or drop a screenshot to clone. Riff builds it and runs it live in a microVM — self-hosted on PandaStack.
        </p>
        <div className="mt-7">
          <PromptComposer framework={framework} setFramework={setFramework} onStart={start} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => start(e, framework)} className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[12.5px] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--ink)]">{e}</button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-12">
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
    </div>
  );
}
