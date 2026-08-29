import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { pandastack } from "@/lib/pandastack";
import { activeRounds } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Hibernate a project's sandbox when the user leaves it idle (scale-to-zero → ~$0).
// Best-effort and safe to call repeatedly. Never hibernate mid-fork-round.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!project.sandboxId || project.activeRoundId || activeRounds.has(id)) return NextResponse.json({ ok: false });
  const status = await pandastack.sandboxStatus(project.sandboxId);
  if (status !== "running") return NextResponse.json({ ok: false });
  const ok = await pandastack.hibernateSandbox(project.sandboxId);
  return NextResponse.json({ ok });
}
