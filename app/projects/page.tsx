"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/types";
import { ProjectCard, Logo } from "@/components/riff-ui";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/projects"); const d = await r.json(); setProjects(d.projects || []); } catch { /* ignore */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const deleteProject = useCallback(async (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try { await fetch(`/api/projects/${id}`, { method: "DELETE" }); } catch { /* ignore */ }
    refresh();
  }, [refresh]);

  return (
    <div className="relative min-h-screen overflow-y-auto px-6 py-[10vh]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[400px] bg-[radial-gradient(50%_100%_at_50%_-10%,rgba(45,212,191,0.10),transparent)]" />
      <div className="relative mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5"><Logo /> <span className="text-lg font-semibold tracking-tight">Riff</span></Link>
          <span className="text-[var(--faint)]">/</span>
          <span className="text-lg font-semibold tracking-tight">Projects</span>
          <span className="rounded-full bg-[var(--panel2)] px-2 py-0.5 text-[11px] text-[var(--faint)]">{projects.length}</span>
          <Link href="/" className="ml-auto rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-3 py-1.5 text-[13px] text-[var(--muted)] transition hover:border-[var(--accent)]/30 hover:text-[var(--ink)]">＋ New</Link>
        </div>
        {projects.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => <ProjectCard key={p.id} p={p} onDelete={deleteProject} />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-10 text-center">
            <div className="text-sm text-[var(--muted)]">{loaded ? "No projects yet." : "Loading…"}</div>
            {loaded && <Link href="/" className="mt-2 inline-block text-[13px] text-[var(--accent)] hover:underline">Build your first app →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
