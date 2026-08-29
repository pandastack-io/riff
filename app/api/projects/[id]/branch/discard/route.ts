import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { discardRound } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Throw away a fork round: tear down every branch, keep the untouched trunk.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const updated = await discardRound(project, body?.roundId);
  return NextResponse.json(updated);
}
