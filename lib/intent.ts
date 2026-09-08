// The intent layer: what Riff understood, before it builds.
//
// A Brief is produced by a FAST model (Haiku 4.5 / gpt-4o-mini class) in ~1-2s and
// streamed to the client ahead of the first build step. It does three jobs at once:
//   1. it is shown to the user, so understanding is VISIBLE rather than implied;
//   2. it is handed to the codegen model as the plan (raising first-build quality);
//   3. its `acceptance` list is the checklist lib/verify.ts runs against the LIVE app.
//
// Two rules shape the design, both from the research:
//   - ASSUME AND STATE, don't interrogate. Ambiguity is surfaced as flippable
//     assumption chips, not a questionnaire. At most ONE blocking question, only
//     when an ambiguity is high-impact AND the project has nothing to show yet.
//   - WHEN IN DOUBT, SHOW. Structural readings become `ambiguities`, whose
//     `readings[].directive` fields are ready-made branch directives — Riff forks
//     the running app into the other readings instead of asking about them.
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Brief, BriefAmbiguity, FileEntry } from "./types";
import type { FrameworkSpec } from "./frameworks";

// Spotting a genuine fork in the road is a judgement call, and it is the whole
// point of this file. Measured on the same prompts, gpt-4o-mini never surfaced one
// — it locks onto the first reading at 0.9 confidence — while gpt-4o separates
// "a booking page for my yoga studio" (customer vs staff: a real fork) from
// "a pomodoro timer with a circular progress ring" (no fork) every time. So the
// default is the capable model; RIFF_FAST_MODEL trades that judgement for cost.
const OPENAI_FAST = process.env.RIFF_FAST_MODEL || process.env.OPENAI_FAST_MODEL || "gpt-4o";
const ANTHROPIC_FAST = process.env.RIFF_FAST_MODEL || process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-4-5-20251001";

export interface BriefRequest {
  prompt: string;
  framework: FrameworkSpec;
  existingBrief?: Brief | null;   // follow-up turns refine rather than replace
  existingAppFiles?: FileEntry[]; // lets a follow-up brief see what exists
  dbAttached?: boolean;
  imageDataUrl?: string;          // image-to-code: read the design, not just the words
}

const SYSTEM = `You are the intent layer for Riff, an AI app builder that generates an app and runs it live in a microVM.

Your job is to read a user's app request and write down WHAT YOU UNDERSTOOD, before any code is written. You are not writing code. You are writing the brief that a code generator will build from and that an automated checker will verify against.

Be concrete and specific to THIS request. Never generic.

Rules for each field:
- title: 2-4 words naming the app.
- oneLiner: one sentence on what it is and who it is for.
- audience: who actually opens this app.
- jobs: 3-6 things the user will DO with it, as short verb phrases.
- screens: the distinct views. Most small apps have exactly one.
- entities: ONLY if the app clearly stores data. Otherwise an empty array.
- assumptions: 2-4 choices you are making that the prompt did not specify, each with a plausible ALTERNATIVE. These are shown as chips the user can flip. Prefer decisions that visibly change the app. Set impact honestly.
- ambiguities: genuine forks in the road, where the prompt supports two or three STRUCTURALLY different apps — different audience, different screens, different data model, or a different primary flow. Colour, copy and defaults are NOT ambiguities; those are assumptions.
  The commonest real fork by far: the prompt names a business or possession ("my bakery", "my studio", "our gym", "a shop") without saying WHO OPENS THE APP. That is almost always a true fork between the customer-facing app (browse, book, buy) and the owner- or staff-facing one (manage, track, fulfil) — two different products. Surface it.
  Do not invent a fork where the prompt is already specific ("a pomodoro timer", "a markdown editor"): return an empty array then. Never more than one fork unless there are genuinely two.
  When there is one, write 2-3 readings. readings[0] MUST be the most likely one, which is what gets built first. Each reading's "directive" is a complete standalone build instruction for that interpretation, written as an imperative sentence — it is fed to a code generator on its own, with no other context.
- acceptance: 4-7 statements that will be VISIBLY TRUE of the finished app, checkable by looking at a screenshot or the DOM of the running page. Write them as observable facts ("a circular progress ring surrounds the countdown"), never as tasks. Avoid anything requiring login, network calls, or waiting.
- nonGoals: 1-3 things you are deliberately NOT building.
- styleDirection: one sentence of visual direction.
- confidence: 0 to 1, how well the prompt pins down the app.

Worked example of the fork you must not miss. For "a dashboard for my bakery", ambiguities is NOT empty — it is exactly one entry:
  axis: "who opens this app"
  question: "Is this for you behind the counter, or for your customers?"
  impact: "high"
  readings: [
    { label: "owner's operations view", directive: "Build an owner-facing bakery operations dashboard: today's takings, orders to fulfil, stock levels for key ingredients, and a sales trend chart for the week." },
    { label: "customer-facing storefront", directive: "Build a customer-facing bakery page: today's fresh menu with prices and photos, opening hours, location, and a simple order-ahead form." }
  ]
Both are legitimate readings of the same six words, and they are completely different apps. That is what an ambiguity is.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    oneLiner: { type: "string" },
    audience: { type: "string" },
    jobs: { type: "array", items: { type: "string" } },
    screens: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, purpose: { type: "string" } }, required: ["name", "purpose"] },
    },
    entities: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, fields: { type: "array", items: { type: "string" } } }, required: ["name", "fields"] },
    },
    assumptions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { text: { type: "string" }, alternative: { type: "string" }, confidence: { type: "number" }, impact: { type: "string", enum: ["low", "med", "high"] } },
        required: ["text", "alternative", "confidence", "impact"],
      },
    },
    ambiguities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          axis: { type: "string" }, question: { type: "string" },
          readings: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, directive: { type: "string" } }, required: ["label", "directive"] } },
          impact: { type: "string", enum: ["low", "med", "high"] },
        },
        required: ["axis", "question", "readings", "impact"],
      },
    },
    acceptance: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, check: { type: "string", enum: ["visual", "dom", "interaction"] } }, required: ["text", "check"] },
    },
    nonGoals: { type: "array", items: { type: "string" } },
    styleDirection: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["title", "oneLiner", "audience", "jobs", "screens", "entities", "assumptions", "ambiguities", "acceptance", "nonGoals", "styleDirection", "confidence"],
} as const;

// The shape the model returns (ids are assigned by us, not the model).
type RawBrief = Omit<Brief, "assumptions" | "ambiguities" | "acceptance" | "decisions" | "verdicts" | "createdAt" | "updatedAt"> & {
  assumptions: { text: string; alternative: string; confidence: number; impact: "low" | "med" | "high" }[];
  ambiguities: { axis: string; question: string; readings: { label: string; directive: string }[]; impact: "low" | "med" | "high" }[];
  acceptance: { text: string; check: "visual" | "dom" | "interaction" }[];
};

function userPrompt(req: BriefRequest): string {
  const parts: string[] = [];
  parts.push(`Target framework: ${req.framework.label}.`);
  if (req.existingBrief) {
    parts.push(
      `This is a FOLLOW-UP to an app that already exists. Here is the current brief — carry it forward and apply the new request to it, keeping everything the request does not change. Keep decisions already made.\n` +
      JSON.stringify({
        title: req.existingBrief.title, oneLiner: req.existingBrief.oneLiner, audience: req.existingBrief.audience,
        jobs: req.existingBrief.jobs, screens: req.existingBrief.screens, entities: req.existingBrief.entities,
        acceptance: req.existingBrief.acceptance.map((a) => a.text), styleDirection: req.existingBrief.styleDirection,
        decided: req.existingBrief.decisions.map((d) => d.readingLabel),
      }, null, 1) +
      `\nBecause the app already exists, return an EMPTY ambiguities array unless the new request itself is genuinely ambiguous.`,
    );
  }
  if (req.dbAttached) parts.push("A real Postgres database is attached to this project, so the app can store and read persistent data.");
  if (req.imageDataUrl) parts.push("A reference design image is attached. Read the design and describe the app it depicts — its screens, its content, and its visual direction.");
  parts.push(`User request: ${req.prompt}`);
  return parts.join("\n\n");
}

// --- providers ---------------------------------------------------------------

async function viaOpenAI(req: BriefRequest): Promise<RawBrief> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content: OpenAI.Chat.ChatCompletionUserMessageParam["content"] = req.imageDataUrl
    ? [{ type: "text", text: userPrompt(req) }, { type: "image_url", image_url: { url: req.imageDataUrl } }]
    : userPrompt(req);
  const r = await client.chat.completions.create({
    model: OPENAI_FAST,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content }],
    prompt_cache_key: `riff-brief-${req.framework.id}`,
    response_format: { type: "json_schema", json_schema: { name: "riff_brief", strict: true, schema: SCHEMA } },
    max_completion_tokens: 2000,
  });
  const raw = r.choices[0]?.message?.content;
  if (!raw) throw new Error("brief: openai returned no content");
  return JSON.parse(raw) as RawBrief;
}

async function viaAnthropic(req: BriefRequest): Promise<RawBrief> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (req.imageDataUrl) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(req.imageDataUrl);
    if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } });
  }
  blocks.push({ type: "text", text: userPrompt(req) });
  const msg = await client.messages.create({
    model: ANTHROPIC_FAST,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "write_brief", description: "Record what you understood about the app request.", input_schema: SCHEMA as unknown as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: "write_brief" },
    messages: [{ role: "user", content: blocks }],
  });
  const tu = msg.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("brief: model did not return write_brief");
  return tu.input as RawBrief;
}

// No-key fallback. Keeps the whole pipeline working (and the Brief card populated)
// with zero API keys, exactly like the template codegen provider does.
function offlineBrief(req: BriefRequest): RawBrief {
  const p = req.prompt.trim();
  const words = p.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 &&
    !/^(the|and|for|with|that|make|build|create|app|please|website|site|a|an|to|me|my)$/i.test(w));
  const title = (words.slice(0, 3).join(" ") || "Your App").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title, oneLiner: p || "An app built with Riff.", audience: "anyone opening the app",
    jobs: ["open the app", "use the main interaction on the page"],
    screens: [{ name: "Home", purpose: "the single page of the app" }], entities: [],
    assumptions: [{ text: "a single page, no navigation", alternative: "multiple screens with navigation", confidence: 0.5, impact: "med" }],
    ambiguities: [],
    acceptance: [
      { text: "the page renders without a blank screen or a runtime error", check: "visual" },
      { text: `the page is recognisably ${title.toLowerCase()}`, check: "visual" },
    ],
    nonGoals: ["accounts or login"], styleDirection: "clean, modern, dark UI",
    confidence: 0.4,
  };
}

export function briefProviderName(): string {
  if (process.env.OPENAI_API_KEY) return `openai:${OPENAI_FAST}`;
  if (process.env.ANTHROPIC_API_KEY) return `anthropic:${ANTHROPIC_FAST}`;
  return "template";
}

// Generate (or refine) the Brief. NEVER throws: a brief is an enhancement, so a
// failure here degrades to the offline brief rather than failing the build.
export async function generateBrief(req: BriefRequest): Promise<Brief> {
  let raw: RawBrief;
  try {
    if (process.env.OPENAI_API_KEY) raw = await viaOpenAI(req);
    else if (process.env.ANTHROPIC_API_KEY) raw = await viaAnthropic(req);
    else raw = offlineBrief(req);
  } catch {
    raw = offlineBrief(req);
  }

  const now = Date.now();
  const seq = (n: number) => `${now.toString(36)}${n}`;
  return {
    title: raw.title || "Your App",
    oneLiner: raw.oneLiner || "",
    audience: raw.audience || "",
    jobs: (raw.jobs || []).slice(0, 8),
    screens: (raw.screens || []).slice(0, 8),
    entities: (raw.entities || []).slice(0, 8),
    assumptions: (raw.assumptions || []).slice(0, 5).map((a, i) => ({
      id: `as${seq(i)}`, text: a.text, alternative: a.alternative,
      confidence: typeof a.confidence === "number" ? a.confidence : 0.6,
      impact: a.impact || "med",
    })),
    // Only keep ambiguities that actually fork: 2+ readings, each with a directive.
    ambiguities: (raw.ambiguities || [])
      .filter((a) => (a.readings || []).filter((r) => r.label && r.directive).length >= 2)
      .slice(0, 2)
      .map((a, i) => ({
        id: `am${seq(i)}`, axis: a.axis, question: a.question || a.axis,
        readings: a.readings.filter((r) => r.label && r.directive).slice(0, 3),
        impact: a.impact || "med",
      })),
    acceptance: (raw.acceptance || []).slice(0, 8).map((a, i) => ({
      id: `ac${seq(i)}`, text: a.text, check: a.check || "visual",
    })),
    nonGoals: (raw.nonGoals || []).slice(0, 4),
    styleDirection: raw.styleDirection || "",
    decisions: req.existingBrief?.decisions ? [...req.existingBrief.decisions] : [],
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.6,
    createdAt: req.existingBrief?.createdAt ?? now,
    updatedAt: now,
  };
}

// --- helpers used by the agent ----------------------------------------------

// Ambiguities the user has not resolved yet (by answering, or by keeping a branch).
export function unresolvedAmbiguities(brief: Brief | null | undefined): BriefAmbiguity[] {
  if (!brief) return [];
  const done = new Set(brief.decisions.map((d) => d.ambiguityId));
  return brief.ambiguities.filter((a) => !done.has(a.id));
}

// The one question worth BLOCKING on: high impact, still open, and we have nothing
// live to show yet. Once an app exists we never block — we offer to fork instead.
export function blockingQuestion(brief: Brief | null | undefined, hasTrunk: boolean): BriefAmbiguity | null {
  if (hasTrunk) return null;
  return unresolvedAmbiguities(brief).find((a) => a.impact === "high") || null;
}

// Fold the Brief into the codegen prompt: the plan, the decisions, the checklist.
export function briefToPrompt(brief: Brief | null | undefined): string {
  if (!brief) return "";
  const L: string[] = [`Build to this brief.`, `App: ${brief.title} — ${brief.oneLiner}`, `For: ${brief.audience}`];
  if (brief.jobs.length) L.push(`It must let the user: ${brief.jobs.join("; ")}.`);
  if (brief.screens.length > 1) L.push(`Screens: ${brief.screens.map((s) => `${s.name} (${s.purpose})`).join("; ")}.`);
  if (brief.entities?.length) L.push(`Data: ${brief.entities.map((e) => `${e.name}(${e.fields.join(", ")})`).join("; ")}.`);
  if (brief.assumptions.length) L.push(`Assume: ${brief.assumptions.map((a) => a.text).join("; ")}.`);
  // Decisions are load-bearing: they are the forks the user already settled, and
  // they must survive the Brief being regenerated (which mints new ambiguity ids),
  // hence the inline directive with a lookup only as a fallback.
  for (const d of brief.decisions) {
    const am = brief.ambiguities.find((a) => a.id === d.ambiguityId);
    const directive = d.directive || am?.readings.find((r) => r.label === d.readingLabel)?.directive;
    if (directive) L.push(`DECIDED — ${am?.axis || d.readingLabel}: ${directive}`);
  }
  if (brief.styleDirection) L.push(`Visual direction: ${brief.styleDirection}.`);
  if (brief.nonGoals.length) L.push(`Do NOT build: ${brief.nonGoals.join("; ")}.`);
  if (brief.acceptance.length) L.push(`The finished app will be checked against these, so every one must be visibly true:\n${brief.acceptance.map((a, i) => `${i + 1}. ${a.text}`).join("\n")}`);
  return L.join("\n");
}
