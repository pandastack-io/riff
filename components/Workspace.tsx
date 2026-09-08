"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentStep, Project, Brief, BriefAmbiguity, BriefAssumption, AcceptanceVerdict } from "@/lib/types";
import { StepRow } from "@/components/ui";
import { BriefCard } from "@/components/BriefCard";
import { TopBar, Composer, PreviewFrame, Versions, ThemePanel, BranchPanel, CompareGrid } from "@/components/riff-ui";

// The project workspace at /project/[id]. Loads the project, wakes its sandbox on
// open (scale-to-zero), runs a pending first build handed off from the home page,
// and hibernates the sandbox when you leave.
export default function Workspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [dbBusy, setDbBusy] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [ghBusy, setGhBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  // The one question the Brief decided was worth blocking on, if any.
  const [needsInput, setNeedsInput] = useState<BriefAmbiguity | null>(null);
  // Opt-in: fork the open reading as soon as the app is live, without being asked.
  const [autoExplore, setAutoExplore] = useState(false);
  const [taste, setTaste] = useState<{ note: string; signals: number } | null>(null);
  const autoFiredFor = useRef<string | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  // The prompt the current brief was built from — replayed verbatim when the user
  // answers the question, so the build continues from the same ask. The attached
  // data file rides along with it: a question about the data must not lose it.
  const promptRef = useRef("");
  const dataRef = useRef<{ name: string; text: string } | undefined>(undefined);
  busyRef.current = busy || branchBusy;

  useEffect(() => { stepsRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [steps]);
  useEffect(() => { try { setAutoExplore(localStorage.getItem("riff:autoExplore") === "1"); } catch { /* ignore */ } }, []);
  const loadTaste = useCallback(async () => {
    try { const r = await fetch("/api/prefs"); if (r.ok) setTaste(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadTaste(); }, [loadTaste]);
  const forgetTaste = useCallback(async () => {
    try { await fetch("/api/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }); } catch { /* ignore */ }
    setTaste(null);
  }, []);
  const toggleAuto = useCallback((v: boolean) => {
    setAutoExplore(v);
    try { localStorage.setItem("riff:autoExplore", v ? "1" : "0"); } catch { /* ignore */ }
  }, []);

  const consume = useCallback(async (res: Response) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split("\n\n"); buf = chunks.pop() || "";
      for (const c of chunks) {
        const ev = /event: (.*)/.exec(c)?.[1];
        const data = /data: (.*)/s.exec(c)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === "step") setSteps((s) => [...s, payload as AgentStep]);
        // The Brief lands before the first build step, and again with verdicts
        // once the running app has been checked against it.
        else if (ev === "brief") setProject((p) => p ? { ...p, brief: payload as Brief } : p);
        else if (ev === "verify") setProject((p) => p?.brief ? { ...p, brief: { ...p.brief, verdicts: payload.verdicts as AcceptanceVerdict[] } } : p);
        else if (ev === "needsInput") setNeedsInput(payload.ambiguity as BriefAmbiguity);
        // A follow-up that undoes something already chosen. Surfaced, not blocked.
        else if (ev === "conflict") setToast({ text: (payload.conflicts as string[]).join(" · "), tone: "err" });
        else if (ev === "done") { setProject(payload as Project); setIframeKey((k) => k + 1); }
        else if (ev === "fatal") setProject((p) => p ? { ...p, status: "error", error: payload.error } : p);
      }
    }
  }, []);

  const runTurn = useCallback(async (
    prompt: string,
    imageDataUrl?: string,
    extra?: {
      decisions?: { ambiguityId: string; readingLabel: string; directive?: string }[];
      resume?: boolean;
      dataFile?: { name: string; text: string };
      tasteSignal?: { kind: "flip" | "correction"; text: string };
    },
  ) => {
    setBusy(true);
    if (!extra?.resume) { promptRef.current = prompt; dataRef.current = extra?.dataFile; }
    setNeedsInput(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, prompt, imageDataUrl, ...extra }),
      });
      await consume(res);
    } finally { setBusy(false); }
  }, [projectId, consume]);

  const wake = useCallback(async () => {
    try { const r = await fetch(`/api/projects/${projectId}/wake`, { method: "POST" }); if (r.ok) { setProject(await r.json()); setIframeKey((k) => k + 1); } } catch { /* ignore */ }
  }, [projectId]);

  // Load the project; run a pending first build, else wake the (possibly asleep) sandbox.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) { if (!cancelled) setNotFound(true); return; }
      const p: Project = await r.json();
      if (cancelled) return;
      setProject(p);
      let pending: { prompt?: string; imageDataUrl?: string; dataFile?: { name: string; text: string } } | null = null;
      try { const raw = sessionStorage.getItem(`riff:pending:${projectId}`); if (raw) { pending = JSON.parse(raw); sessionStorage.removeItem(`riff:pending:${projectId}`); } } catch { /* ignore */ }
      if (pending) {
        const prompt = pending.prompt || "";
        setProject((cur) => cur ? { ...cur, messages: [...cur.messages, { id: "u0", role: "user", text: prompt || "Reproduce this design.", ts: Date.now() }] } : cur);
        runTurn(prompt || "Reproduce the attached design faithfully.", pending.imageDataUrl, { dataFile: pending.dataFile });
      } else {
        // Reopening: restore the persisted build trace so the conversation looks
        // exactly as it did live, then wake the (possibly hibernated) sandbox.
        setSteps(p.steps || []);
        if (p.sandboxId && p.status !== "new") wake();
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, runTurn, wake]);

  // Scale-to-zero: hibernate the sandbox when leaving (route change or tab close),
  // unless a build/round is in flight.
  useEffect(() => {
    const beacon = () => { if (!busyRef.current) navigator.sendBeacon?.(`/api/projects/${projectId}/hibernate`, ""); };
    window.addEventListener("beforeunload", beacon);
    return () => {
      window.removeEventListener("beforeunload", beacon);
      if (!busyRef.current) fetch(`/api/projects/${projectId}/hibernate`, { method: "POST", keepalive: true }).catch(() => {});
    };
  }, [projectId]);

  const followUp = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim(); if (!trimmed || busy || !project) return;
    setInput("");
    setProject({ ...project, messages: [...project.messages, { id: "u" + Date.now(), role: "user", text: trimmed, ts: Date.now() }] });
    await runTurn(trimmed);
  }, [busy, project, runTurn]);

  // The user answered the one question — replay the same prompt with the choice.
  const answerQuestion = useCallback(async (a: BriefAmbiguity, readingLabel: string, directive: string) => {
    if (busy) return;
    setNeedsInput(null);
    const base = promptRef.current || [...(project?.messages || [])].reverse().find((m) => m.role === "user")?.text || "";
    setProject((p) => p ? { ...p, messages: [...p.messages, { id: "u" + Date.now(), role: "user", text: readingLabel, ts: Date.now() }] } : p);
    await runTurn(base, undefined, { decisions: [{ ambiguityId: a.id, readingLabel, directive }], resume: true, dataFile: dataRef.current });
  }, [busy, project, runTurn]);

  // Flipping an assumption chip is just a very well-specified follow-up build.
  const flipAssumption = useCallback(async (a: BriefAssumption) => {
    if (busy || !project) return;
    const prompt = `Change one thing: instead of ${a.text}, ${a.alternative}. Keep everything else about the app exactly as it is.`;
    setProject({ ...project, messages: [...project.messages, { id: "u" + Date.now(), role: "user", text: a.alternative, ts: Date.now() }] });
    await runTurn(prompt, undefined, { tasteSignal: { kind: "flip", text: `chose "${a.alternative}" over "${a.text}"` } });
  }, [busy, project, runTurn]);

  const restore = useCallback(async (checkpointId: string) => {
    if (busy || !project) return;
    setBusy(true); setSteps([]);
    try {
      const res = await fetch(`/api/projects/${project.id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkpointId }) });
      await consume(res);
    } finally { setBusy(false); }
  }, [busy, project, consume]);

  const addDatabase = useCallback(async () => {
    if (dbBusy || !project || project.activeRoundId) return;
    setDbBusy(true);
    setProject({ ...project, database: { id: "…", status: "provisioning", createdAt: Date.now() } });
    try { const res = await fetch(`/api/projects/${project.id}/database`, { method: "POST" }); setProject(await res.json()); } finally { setDbBusy(false); }
  }, [dbBusy, project]);

  const applyTheme = useCallback(async (directive: string) => {
    setShowTheme(false);
    if (!project || busy) return;
    setSteps([]);
    setProject({ ...project, messages: [...project.messages, { id: "u" + Date.now(), role: "user", text: directive, ts: Date.now() }] });
    await runTurn(directive);
  }, [project, busy, runTurn]);

  const exportGitHub = useCallback(async () => {
    if (ghBusy || !project) return;
    setGhBusy(true); setToast(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/github`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) setToast({ text: "Pushed to GitHub", href: data.url, tone: "ok" });
      else setToast({ text: data.error || "Export failed", tone: "err" });
    } catch (e) { setToast({ text: e instanceof Error ? e.message : "Export failed", tone: "err" }); }
    finally { setGhBusy(false); }
  }, [ghBusy, project]);

  const consumeBranch = useCallback(async (res: Response) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split("\n\n"); buf = chunks.pop() || "";
      for (const c of chunks) {
        const ev = /event: (.*)/.exec(c)?.[1];
        const data = /data: (.*)/s.exec(c)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === "round") {
          setProject((p) => p ? { ...p, rounds: [...(p.rounds || []).filter((r) => r.id !== payload.round.id), payload.round], branches: [...(p.branches || []).filter((b) => b.roundId !== payload.round.id), ...payload.branches], activeRoundId: payload.round.id } : p);
        } else if (ev === "branch") {
          setProject((p) => p ? { ...p, branches: (p.branches || []).map((b) => b.id === payload.branchId ? { ...b, ...payload.patch } : b) } : p);
        } else if (ev === "done") { setProject(payload as Project); }
        else if (ev === "fatal") { setProject((p) => p ? { ...p, error: payload.error } : p); }
      }
    }
  }, []);

  const startRound = useCallback(async (
    basePrompt: string, directives: string[],
    resolve?: { ambiguityId: string; labels: string[]; trunkLabel: string },
  ) => {
    if (branchBusy || !project) return;
    setShowBranch(false); setBranchBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/branch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basePrompt, directives, resolve }) });
      await consumeBranch(res);
    } finally { setBranchBusy(false); }
  }, [branchBusy, project, consumeBranch]);

  // The wow: resolve an open reading by forking the RUNNING app into every
  // interpretation and putting them side by side, instead of asking about it.
  const exploreReadings = useCallback(async (a: BriefAmbiguity) => {
    if (branchBusy || !project) return;
    const readings = a.readings.slice(0, 4);
    if (readings.length < 2) return;
    await startRound(
      promptRef.current || project.brief?.oneLiner || project.name,
      readings.map((r) => r.directive),
      { ambiguityId: a.id, labels: readings.map((r) => r.label), trunkLabel: readings[0].label },
    );
  }, [branchBusy, project, startRound]);

  const keepWinner = useCallback(async (branchId: string) => {
    if (!project) return;
    setBranchBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/branch/keep`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId }) });
      const updated: Project = await res.json();
      const label = updated.branches?.find((b) => b.id === branchId)?.label;
      setProject(updated); setIframeKey((k) => k + 1);
      setToast({ text: `Kept variation ${label ?? ""} — it's your main line now`, tone: "ok" });
      setTimeout(loadTaste, 2500); // the note is distilled just after the keep lands
    } finally { setBranchBusy(false); }
  }, [project]);

  const discardAll = useCallback(async (keepTrunk = false) => {
    if (!project) return;
    setBranchBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/branch/discard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepTrunk }) });
      setProject(await res.json()); setIframeKey((k) => k + 1);
      setToast({ text: keepTrunk ? "Kept the original — that's your main line" : "Discarded the branches — back to your main line", tone: "ok" });
    } finally { setBranchBusy(false); }
  }, [project]);

  // Auto-explore: once the app is live and idle, fork the top open reading without
  // being asked. Guarded per-ambiguity so it fires once, never in a loop.
  useEffect(() => {
    if (!autoExplore || !project?.brief || busy || branchBusy || project.activeRoundId) return;
    if (project.status !== "live" || !project.sandboxId) return;
    const decided = new Set(project.brief.decisions.map((d) => d.ambiguityId));
    const open = project.brief.ambiguities.find((a) => !decided.has(a.id) && a.impact === "high" && a.readings.length >= 2);
    if (!open || autoFiredFor.current === open.id) return;
    autoFiredFor.current = open.id;
    exploreReadings(open);
  }, [autoExplore, project, busy, branchBusy, exploreReadings]);

  if (notFound) return <div className="grid h-screen place-items-center text-sm text-[var(--faint)]">Project not found. <button onClick={() => router.push("/")} className="ml-2 text-[var(--accent)]">Go home →</button></div>;
  if (!project) return <div className="grid h-screen place-items-center text-sm text-[var(--muted)]">Loading…</div>;

  const lastUserPrompt = [...project.messages].reverse().find((m) => m.role === "user")?.text || "";
  const canBranch = project.status === "live" && !!project.sandboxId && !project.activeRoundId && !busy && !branchBusy;

  return (
    <div className="app-shell flex h-screen flex-col">
      <TopBar project={project} onAddDatabase={addDatabase} dbBusy={dbBusy}
        onOpenTheme={() => { setShowTheme((v) => !v); setShowBranch(false); }} themeOpen={showTheme}
        onOpenBranch={() => { setShowBranch((v) => !v); setShowTheme(false); }} branchOpen={showBranch} canBranch={canBranch}
        onExport={exportGitHub} ghBusy={ghBusy} />
      {showTheme && <ThemePanel busy={busy} onApply={applyTheme} onClose={() => setShowTheme(false)} />}
      {showBranch && <BranchPanel busy={branchBusy} lastPrompt={lastUserPrompt} onExplore={startRound} onClose={() => setShowBranch(false)} />}
      {toast && (
        <div className={`absolute right-3 top-14 z-40 max-w-[320px] rounded-lg border px-3 py-2 text-[12.5px] shadow-xl ${toast.tone === "ok" ? "border-teal-500/30 bg-teal-500/10 text-teal-100" : "border-rose-500/30 bg-rose-500/10 text-rose-100"}`}>
          <div className="flex items-start gap-2">
            <span>{toast.text}{toast.href && <> — <a className="underline" href={toast.href} target="_blank" rel="noreferrer">open repo ↗</a></>}</span>
            <button onClick={() => setToast(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,420px)_1fr]">
        <section className="flex min-h-0 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
          <div ref={stepsRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {project.brief && (
              <BriefCard
                brief={project.brief} needsInput={needsInput} busy={busy}
                canFork={canBranch} autoExplore={autoExplore} taste={taste}
                onAnswer={answerQuestion} onFlip={flipAssumption} onExplore={exploreReadings}
                onToggleAuto={toggleAuto} onForgetTaste={forgetTaste}
              />
            )}
            {project.messages.map((m) => (
              m.role === "user"
                ? <div key={m.id} className="mb-3 ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-[var(--accent-dim)]/25 px-3.5 py-2 text-[13.5px] text-teal-50">{m.text}</div>
                : <div key={m.id} className="mb-3 max-w-[94%] text-[13.5px] leading-relaxed text-neutral-300">{m.text}</div>
            ))}
            {steps.length > 0 && (
              <div className="mt-1 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                {steps.map((s, i) => <StepRow key={s.id} step={s} last={i === steps.length - 1} />)}
              </div>
            )}
          </div>
          <Versions project={project} busy={busy} onRestore={restore} />
          <Composer value={input} setValue={setInput} onSend={followUp} busy={busy || !!project.activeRoundId} placeholder={project.activeRoundId ? "Pick a winner first…" : "Ask for a change…"} />
        </section>
        <section className="flex min-h-0 flex-col bg-[var(--bg)]">
          {project.activeRoundId
            ? <CompareGrid project={project} busy={branchBusy} onKeep={keepWinner} onDiscard={() => discardAll(false)} onKeepTrunk={() => discardAll(true)} />
            : <PreviewFrame project={project} busy={busy} iframeKey={iframeKey} onRefresh={() => setIframeKey((k) => k + 1)} />}
        </section>
      </div>
    </div>
  );
}
