import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { runAgentTurn } from "@/lib/agent";
import type { AgentStep } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { projectId, prompt, imageDataUrl } = await req.json();
  const project = await store.get(projectId);
  if (!project) return new Response(JSON.stringify({ error: "project not found" }), { status: 404 });
  const text = String(prompt || "").trim();
  const image = typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/") ? imageDataUrl : undefined;
  if (!text && !image) return new Response(JSON.stringify({ error: "empty prompt" }), { status: 400 });

  project.messages.push({ id: `m${Date.now()}`, role: "user", text: text || "Reproduce this design.", ts: Date.now() });
  await store.put(project);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const emit = (s: AgentStep) => send("step", s);
      try {
        const updated = await runAgentTurn(project, text || "Reproduce the attached design.", emit, { imageDataUrl: image });
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
