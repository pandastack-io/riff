import { NextRequest } from "next/server";
import { store } from "@/lib/store";
import { runAgentTurn, type BriefDecision } from "@/lib/agent";
import { parseDataset } from "@/lib/data";
import type { AgentStep } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { projectId, prompt, imageDataUrl, decisions, resume, dataFile, tasteSignal } = await req.json();
  const project = await store.get(projectId);
  if (!project) return new Response(JSON.stringify({ error: "project not found" }), { status: 404 });
  const text = String(prompt || "").trim();
  const image = typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:image/") ? imageDataUrl : undefined;
  if (!text && !image && !dataFile) return new Response(JSON.stringify({ error: "empty prompt" }), { status: 400 });

  // The raw file is parsed HERE, not trusted from the client: identifiers are
  // re-derived and the contents only ever reach a model quoted as data.
  const dataset = dataFile && typeof dataFile.name === "string" && typeof dataFile.text === "string"
    ? parseDataset(dataFile.name, dataFile.text.slice(0, 400_000)) ?? undefined
    : undefined;

  // A resume is the user answering the Brief's one question. The original prompt
  // is already in the transcript — log the ANSWER instead of repeating the ask.
  const picks: BriefDecision[] = Array.isArray(decisions)
    ? decisions
        .filter((d: unknown): d is BriefDecision => !!d && typeof (d as BriefDecision).ambiguityId === "string" && typeof (d as BriefDecision).readingLabel === "string")
        .slice(0, 4)
    : [];
  project.messages.push({
    id: `m${Date.now()}`,
    role: "user",
    text: resume && picks.length ? picks.map((d) => d.readingLabel).join(", ") : (text || "Reproduce this design."),
    ts: Date.now(),
  });
  await store.put(project);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const emit = (s: AgentStep) => send("step", s);
      try {
        const updated = await runAgentTurn(project, text || "Reproduce the attached design.", emit, {
          imageDataUrl: image,
          decisions: picks,
          dataset,
          tasteSignal: tasteSignal && (tasteSignal.kind === "flip" || tasteSignal.kind === "correction")
            ? { kind: tasteSignal.kind, text: String(tasteSignal.text || "").slice(0, 300) }
            : undefined,
          onEvent: send,
        });
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
