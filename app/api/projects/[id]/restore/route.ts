import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { restoreCheckpoint } from "@/lib/agent";
import type { AgentStep } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Restore a checkpoint, streaming progress steps like /api/chat does.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { checkpointId } = await req.json();
  const project = await store.get(id);
  if (!project) return new Response(JSON.stringify({ error: "project not found" }), { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const emit = (s: AgentStep) => send("step", s);
      try {
        const updated = await restoreCheckpoint(project, String(checkpointId), emit);
        send("done", updated);
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
