import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { pandastack } from "@/lib/pandastack";
import { frameworkFor } from "@/lib/frameworks";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Wake a project's sandbox on reopen (scale-to-zero). Hibernated → wake (~1–2s,
// the dev server is still running from the memory snapshot) → confirm serving.
// Running → just confirm. Gone → leave it; the workspace re-boots on the next edit.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!project.sandboxId) return NextResponse.json(project);

  const status = await pandastack.sandboxStatus(project.sandboxId);
  if (!status) return NextResponse.json(project); // gone — reboots on next edit

  if (status === "hibernated" || status === "paused") await pandastack.wakeSandbox(project.sandboxId);

  // Confirm the preview is actually back before reporting live.
  const fw = frameworkFor(project.framework);
  const res = await pandastack.waitForServing(project.sandboxId, fw.port, 30000);
  const updated = (await store.mutate(id, (p) => {
    if (res.ok) { p.status = "live"; p.previewUrl = pandastack.previewUrl(p.sandboxId!, fw.port); }
  })) || project;
  return NextResponse.json(updated);
}
