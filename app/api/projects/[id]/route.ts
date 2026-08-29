import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { pandastack } from "@/lib/pandastack";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await store.get(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(p);
}

// Delete a project and tear down ALL its cloud resources: the trunk sandbox + DB,
// any live branch sandboxes + their cloned DBs, and any deferred old-source DBs.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await store.get(id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sandboxes = new Set<string>();
  if (p.sandboxId) sandboxes.add(p.sandboxId);
  for (const b of p.branches || []) if (b.sandboxId) sandboxes.add(b.sandboxId);
  await Promise.allSettled([...sandboxes].map((sid) => pandastack.deleteSandbox(sid)));

  // Delete clone DBs first (they depend on the source), then the source + any pending.
  const cloneDbs = new Set<string>();
  for (const b of p.branches || []) if (b.databaseId) cloneDbs.add(b.databaseId);
  await Promise.allSettled([...cloneDbs].map((d) => pandastack.deleteDatabase(d)));
  const sourceDbs = new Set<string>([...(p.pendingDbDeletes || [])]);
  if (p.database?.id) sourceDbs.add(p.database.id);
  await Promise.allSettled([...sourceDbs].map((d) => pandastack.deleteDatabase(d)));

  await store.del(id);
  return NextResponse.json({ ok: true });
}
