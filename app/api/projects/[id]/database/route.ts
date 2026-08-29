import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { pandastack } from "@/lib/pandastack";
import { activeRounds } from "@/lib/agent";
import type { DatabaseInfo } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Provision a managed Postgres for this project and block until it is running
// (30–90s). Idempotent-ish: returns the existing DB if one is already attached.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (project.database?.status === "running") return NextResponse.json(project);
  // Refuse while a fork round is in flight — attaching mid-round would race the
  // round's long-lived writes and could strand the DB.
  if (activeRounds.has(id) || project.activeRoundId) return NextResponse.json({ error: "finish or discard the current branch round first" }, { status: 409 });

  const created = await pandastack.createDatabase(`riff-${project.id}`);
  // Record the DB immediately (RMW) so a crash mid-provision doesn't orphan it.
  await store.mutate(id, (fp) => { fp.database = { id: created.id, status: "provisioning", createdAt: Date.now() }; });

  // Poll until the database reports running (with its connection URL).
  const db: DatabaseInfo = { id: created.id, status: "provisioning", createdAt: Date.now() };
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const info = await pandastack.getDatabase(created.id);
      db.status = info.status;
      if (info.connection_url) db.connectionUrl = info.connection_url;
      if (info.status === "running" && info.connection_url) break;
      if (info.status === "error") break;
    } catch { /* transient — keep polling */ }
  }
  // Merge the final DB state onto the latest project (don't clobber concurrent edits).
  const updated = (await store.mutate(id, (fp) => { fp.database = db; })) || project;
  return NextResponse.json(updated);
}

// Detach and delete the managed database.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (project.database?.id) await pandastack.deleteDatabase(project.database.id);
  project.database = null;
  await store.put(project);
  return NextResponse.json(project);
}
