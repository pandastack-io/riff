import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { keepBranch } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Promote a live branch to the new trunk and tear down the losers + old trunk.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { branchId } = await req.json();
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  const updated = await keepBranch(project, String(branchId));
  return NextResponse.json(updated);
}
