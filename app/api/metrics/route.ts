import { NextResponse } from "next/server";
import { store } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The five measures the plan said this work should be judged by, computed from the
// append-only event log rather than kept as running counters — so a definition can
// be corrected later without the history having been collected wrongly.
export async function GET() {
  const events = store.readMetrics();
  const turns = events.filter((e) => e.kind === "turn");
  const verifies = events.filter((e) => e.kind === "verify");
  const rounds = events.filter((e) => e.kind === "round");
  const keeps = events.filter((e) => e.kind === "keep");

  // A "correction" is a follow-up that fixes rather than extends: a tweak, or any
  // turn where the acceptance check had to intervene.
  const byProject = new Map<string, typeof turns>();
  for (const t of turns) byProject.set(t.projectId, [...(byProject.get(t.projectId) || []), t]);

  let accepted = 0, judged = 0, corrections = 0;
  for (const [, ts] of byProject) {
    const first = ts.find((t) => t.data.firstBuild);
    if (first) {
      judged++;
      const after = ts.filter((t) => t.ts > first.ts).slice(0, 2);
      if (!after.some((t) => t.data.kind === "tweak")) accepted++;
    }
    corrections += ts.filter((t) => t.data.kind === "tweak").length;
  }

  const serveTimes = turns.filter((t) => t.data.ok && typeof t.data.ms === "number").map((t) => t.data.ms as number).sort((a, b) => a - b);
  const p50 = serveTimes.length ? serveTimes[Math.floor(serveTimes.length / 2)] : null;
  const caught = verifies.filter((v) => v.data.caughtMiss).length;

  return NextResponse.json({
    projects: byProject.size,
    turns: turns.length,
    firstBuildAcceptance: judged ? +(accepted / judged).toFixed(3) : null,
    correctiveFollowUpsPerProject: byProject.size ? +(corrections / byProject.size).toFixed(2) : null,
    verifyCatchRate: verifies.length ? +(caught / verifies.length).toFixed(3) : null,
    verifyRuns: verifies.length,
    interactionsDriven: verifies.reduce((n, v) => n + ((v.data.interactions as number) || 0), 0),
    medianTurnMs: p50,
    forkRounds: rounds.length,
    forkKeepRate: rounds.length ? +(keeps.length / rounds.length).toFixed(3) : null,
    note: "Computed from the local event log in .riff/riff.db. Nothing leaves this machine.",
  });
}
