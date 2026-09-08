// What Riff has learned about how you like things.
//
// Every other builder would have to ask you to fill in a style preferences form.
// Riff already watches you make the decision that matters: which forked variation
// you KEEP and which you throw away. That, plus which assumptions you flip and
// what you keep correcting, is a stronger signal than anything you would type —
// and it costs you nothing to give.
//
// The note it distils is injected into both the Brief and codegen prompts, and is
// shown to you so you can see (and correct) what Riff thinks your taste is.
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { store } from "./store";
import type { Prefs, TasteSignal } from "./types";

const OPENAI_FAST = process.env.RIFF_FAST_MODEL || process.env.OPENAI_FAST_MODEL || "gpt-4o";
const ANTHROPIC_FAST = process.env.RIFF_FAST_MODEL || process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5-20251001";

const MAX_SIGNALS = 40;
// Two, because the smallest real fork round is two variations: keeping one of them
// yields exactly one keep and one rejection, and that pair is already a preference
// worth acting on. Waiting for a third would make the commonest case never learn.
const DISTIL_EVERY = 2;
export function tasteEnabled(): boolean {
  return process.env.RIFF_TASTE !== "0" && !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// Record something the user just decided. Fire-and-forget: taste is a nicety and
// must never slow down or break a build.
export async function recordSignal(kind: TasteSignal["kind"], text: string): Promise<void> {
  const t = (text || "").trim();
  if (!tasteEnabled() || !t) return;
  try {
    await store.mutatePrefs((p) => {
      p.signals = [...p.signals, { kind, text: t.slice(0, 300), ts: Date.now() }].slice(-MAX_SIGNALS);
    });
  } catch { /* ignore */ }
}

const SYSTEM = `You infer a person's design taste from the choices they actually made while building apps, and write it down as instructions for a code generator.

You are given evidence, not opinions: variations they KEPT, variations they REJECTED, defaults they FLIPPED, and corrections they asked for repeatedly. A rejection is as informative as a keep.

Write two or three short sentences, in the second person, describing only what the evidence supports: visual direction, density, colour, typography, motion, and how much chrome they want. Be concrete and usable by a code generator ("you prefer dark, dense layouts with tabular numerals and almost no animation").

Say nothing you cannot support. If the evidence is thin or contradictory, say so plainly and keep it short. Never invent a preference to fill space. Do not mention specific apps or projects.`;

async function distil(signals: TasteSignal[]): Promise<string> {
  const evidence = signals.map((s) => `- ${s.kind}: ${s.text}`).join("\n");
  const user = `Evidence, oldest first:\n${evidence}\n\nWrite the taste note.`;
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.chat.completions.create({
      model: OPENAI_FAST, max_completion_tokens: 220,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    });
    return (r.choices[0]?.message?.content || "").trim();
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: ANTHROPIC_FAST, max_tokens: 220, system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const first = msg.content.find((b) => b.type === "text");
  return first && first.type === "text" ? first.text.trim() : "";
}

// Re-distil once enough new evidence has accumulated. Never throws.
export async function maybeDistil(force = false): Promise<Prefs | null> {
  if (!tasteEnabled()) return null;
  try {
    const p = await store.getPrefs();
    if (p.signals.length < DISTIL_EVERY) return p;
    if (!force && p.signals.length - p.distilledAt < DISTIL_EVERY) return p;
    const note = await distil(p.signals);
    if (!note) return p;
    return await store.mutatePrefs((cur) => { cur.note = note.slice(0, 600); cur.distilledAt = cur.signals.length; });
  } catch { return null; }
}

export function tasteToPrompt(prefs: Prefs | null | undefined): string {
  if (!prefs?.note) return "";
  return `What this user tends to like, learned from variations they kept and rejected. Apply it unless the request says otherwise, and never let it override an explicit instruction:\n${prefs.note}`;
}
