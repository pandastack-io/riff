"use client";
import type { AgentStep, ProjectStatus } from "@/lib/types";

const STATUS: Record<ProjectStatus, { label: string; tone: string; busy?: boolean }> = {
  new:        { label: "New", tone: "text-neutral-400" },
  booting:    { label: "Booting VM", tone: "text-sky-300", busy: true },
  generating: { label: "Generating", tone: "text-violet-300", busy: true },
  installing: { label: "Installing", tone: "text-amber-300", busy: true },
  starting:   { label: "Starting", tone: "text-amber-300", busy: true },
  checking:   { label: "Checking", tone: "text-amber-300", busy: true },
  live:       { label: "Live", tone: "text-teal-300" },
  error:      { label: "Error", tone: "text-rose-300" },
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium ${s.tone}`}>
      {s.busy ? <Spinner /> : <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-teal-400" : status === "error" ? "bg-rose-400" : "bg-neutral-500"}`} style={status === "live" ? { animation: "pulse 1.6s ease-in-out infinite" } : undefined} />}
      {s.label}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`spin inline-block h-3 w-3 rounded-full border-[1.5px] border-current border-t-transparent ${className}`} />;
}

const ICON: Record<AgentStep["kind"], string> = {
  plan: "◇", write: "✎", install: "⤓", start: "▶", check: "◈", fix: "⟳", done: "✓", error: "✕", log: "·", db: "⛁",
};
export function StepRow({ step, last }: { step: AgentStep; last: boolean }) {
  const tone = step.kind === "done" ? "text-teal-300" : step.kind === "error" ? "text-rose-300" : step.kind === "fix" ? "text-amber-300" : "text-neutral-300";
  return (
    <div className="animate-fadeup flex gap-3 py-1.5">
      <div className="mt-0.5 flex flex-col items-center">
        <span className={`grid h-5 w-5 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] ${tone}`}>{ICON[step.kind]}</span>
        {!last && <span className="mt-1 w-px flex-1 bg-white/8" />}
      </div>
      <div className="min-w-0 pb-1">
        <div className={`text-[13px] leading-snug ${tone}`}>{step.label}</div>
        {step.detail && <div className="mono mt-0.5 truncate text-[11px] text-neutral-500" title={step.detail}>{step.detail}</div>}
      </div>
    </div>
  );
}
