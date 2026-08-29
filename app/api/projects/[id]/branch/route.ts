import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { runBranchRound, activeRounds } from "@/lib/agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Fan out N CoW-forked branches from one prompt, streaming coarse per-branch
// transitions (round / branch / done / fatal) so each tile flips live independently.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { basePrompt, directives } = await req.json();
  const project = await store.get(id);
  if (!project) return new Response(JSON.stringify({ error: "project not found" }), { status: 404 });
  // One fork round per project at a time (also blocks if a stale round is still winding down).
  if (activeRounds.has(id) || project.activeRoundId) return new Response(JSON.stringify({ error: "a branch round is already in progress" }), { status: 409 });
  const dirs: string[] = Array.isArray(directives) ? directives.map(String) : [];
  if (dirs.filter((d) => d.trim()).length < 2) return new Response(JSON.stringify({ error: "need at least 2 branch directives" }), { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await runBranchRound(project, String(basePrompt || "").trim(), dirs, send);
      } catch (e) {
        send("fatal", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
