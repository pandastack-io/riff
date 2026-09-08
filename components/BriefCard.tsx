"use client";
import { useState } from "react";
import type { Brief, BriefAmbiguity, BriefAssumption, VerdictStatus } from "@/lib/types";
import { Spinner } from "@/components/ui";

// What Riff understood, shown before it builds and kept in view while it does.
//
// Three things live here, in the order they matter:
//   - the ONE question, when a prompt genuinely forks and nothing is live yet;
//   - the readings Riff can still SHOW you, once the app is up (the fork offer);
//   - the acceptance checklist, ticking over as verification runs.
// Everything else is stated, not asked: assumptions are chips you can flip.

const TICK: Record<VerdictStatus, { mark: string; tone: string }> = {
  pass: { mark: "✓", tone: "text-teal-300" },
  fail: { mark: "✕", tone: "text-rose-300" },
  unverifiable: { mark: "–", tone: "text-[var(--faint)]" },
};

export function BriefCard({ brief, needsInput, busy, canFork, onAnswer, onFlip, onExplore }: {
  brief: Brief;
  needsInput: BriefAmbiguity | null;
  busy: boolean;
  canFork: boolean;
  onAnswer: (a: BriefAmbiguity, readingLabel: string, directive: string) => void;
  onFlip: (a: BriefAssumption) => void;
  onExplore: (a: BriefAmbiguity) => void;
}) {
  const [open, setOpen] = useState(true);
  const verdicts = brief.verdicts || [];
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const decided = new Set(brief.decisions.map((d) => d.ambiguityId));
  const openReadings = brief.ambiguities.filter((a) => !decided.has(a.id) && a.id !== needsInput?.id);
  const failed = verdicts.filter((v) => v.status === "fail").length;
  const passed = verdicts.filter((v) => v.status === "pass").length;

  return (
    <div className="animate-fadeup mb-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel2)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.02]">
        <span className="text-[11px] uppercase tracking-wide text-[var(--accent)]">Understood</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ink)]">{brief.title}</span>
        {verdicts.length > 0 && (
          <span className={`mono shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] ${failed ? "bg-rose-500/10 text-rose-300" : "bg-teal-500/10 text-teal-300"}`}>
            {failed ? `${failed} missing` : `${passed}/${verdicts.length} ✓`}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-[var(--faint)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
            {brief.oneLiner}{brief.audience ? <span className="text-[var(--faint)]"> · for {brief.audience}</span> : null}
          </p>

          {brief.jobs.length > 0 && (
            <Row label="Does">
              <span className="text-[12px] leading-relaxed text-[var(--muted)]">{brief.jobs.join(" · ")}</span>
            </Row>
          )}

          {/* The one blocking question. Always has a default and an escape. */}
          {needsInput && (
            <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)]/15 p-2.5">
              <div className="mb-2 text-[12.5px] font-medium text-[var(--ink)]">{needsInput.question}</div>
              <div className="flex flex-wrap gap-1.5">
                {needsInput.readings.map((r, i) => (
                  <button key={r.label} disabled={busy} onClick={() => onAnswer(needsInput, r.label, r.directive)} title={r.directive}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40 ${i === 0
                      ? "bg-[var(--accent)] text-neutral-950 hover:bg-teal-300"
                      : "border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] hover:border-[var(--accent)]/40 hover:text-[var(--ink)]"}`}>
                    {r.label}
                  </button>
                ))}
                <button disabled={busy} onClick={() => onAnswer(needsInput, needsInput.readings[0].label, needsInput.readings[0].directive)}
                  className="rounded-full border border-dashed border-[var(--line)] px-2.5 py-1 text-[11.5px] text-[var(--faint)] transition hover:text-[var(--muted)] disabled:opacity-40">
                  Just build it
                </button>
              </div>
            </div>
          )}

          {/* Show me, don't ask me — resolve the rest by forking the RUNNING app. */}
          {openReadings.map((a) => (
            <div key={a.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2.5">
              <div className="text-[12px] leading-relaxed text-[var(--muted)]">
                I built <span className="text-[var(--ink)]">{a.readings[0].label}</span>. It could also be{" "}
                {a.readings.slice(1).map((r, i) => (
                  <span key={r.label}>{i > 0 ? " or " : ""}<span className="text-[var(--ink)]">{r.label}</span></span>
                ))}.
              </div>
              <button disabled={!canFork} onClick={() => onExplore(a)}
                title={canFork ? "Fork the running app into the other readings" : "Wait for the app to be live"}
                className="mt-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-dim)]/15 px-2.5 py-1 text-[11.5px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-dim)]/25 disabled:opacity-40">
                ⑂ Show me both, side by side
              </button>
            </div>
          ))}

          {/* Assumptions: stated, not asked. Flipping one queues a follow-up build. */}
          {brief.assumptions.length > 0 && (
            <Row label="Assuming">
              <div className="flex flex-wrap gap-1.5">
                {brief.assumptions.map((a) => (
                  <button key={a.id} disabled={busy} onClick={() => onFlip(a)} title={`Switch to: ${a.alternative}`}
                    className="group flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[11.5px] text-[var(--muted)] transition hover:border-[var(--accent)]/40 hover:text-[var(--ink)] disabled:opacity-40">
                    <span>{a.text}</span>
                    <span className="text-[var(--faint)] transition group-hover:text-[var(--accent)]">⇄</span>
                  </button>
                ))}
              </div>
            </Row>
          )}

          {/* The checklist — the spec AND the verification report, same list. */}
          {brief.acceptance.length > 0 && (
            <Row label={verdicts.length ? "Checked" : "Will check"}>
              <ul className="flex flex-col gap-1">
                {brief.acceptance.map((a) => {
                  const v = byId.get(a.id);
                  const t = v ? TICK[v.status] : null;
                  return (
                    <li key={a.id} className="flex items-start gap-2 text-[12px] leading-snug">
                      <span className={`mt-px w-3 shrink-0 text-center ${t ? t.tone : "text-[var(--faint)]"}`}>{t ? t.mark : "·"}</span>
                      <span className={v?.status === "fail" ? "text-[var(--ink)]" : "text-[var(--muted)]"}>
                        {a.text}
                        {v?.status === "fail" && v.reason && <span className="block text-[11px] text-rose-300/80">{v.reason}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Row>
          )}

          {brief.decisions.length > 0 && (
            <Row label="Decided">
              <span className="text-[12px] text-[var(--muted)]">{brief.decisions.map((d) => d.readingLabel).join(" · ")}</span>
            </Row>
          )}

          {busy && !needsInput && (
            <div className="flex items-center gap-2 text-[11.5px] text-[var(--faint)]"><Spinner className="!h-2.5 !w-2.5" /> building to this brief…</div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="w-[64px] shrink-0 pt-px text-[10.5px] uppercase tracking-wide text-[var(--faint)]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
