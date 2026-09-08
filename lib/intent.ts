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
import type { AcceptanceAction, Brief, BriefAmbiguity, FileEntry } from "./types";
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
  datasetNote?: string;           // shape + sample of a data file the user dropped in
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
- acceptance: 4-7 statements that will be VISIBLY TRUE of the finished app, checkable by looking at a screenshot or the DOM of the running page. Write them as observable facts ("a circular progress ring surrounds the countdown"), never as tasks. Avoid anything requiring login or network calls.
  Set check to "interaction" ONLY when the claim needs someone to use the app first ("after pressing Start the countdown decreases"). For those, and ONLY those, write 1-3 "actions" that a browser will actually perform before the screenshot is taken. Target elements by their VISIBLE LABEL or placeholder text, never a CSS selector or an id. Use kind "wait" with a millisecond value to let something happen — but a wait is CAPPED AT 4000ms, so never write a criterion that needs longer than a few seconds to become true. "The timer resets after 25 minutes" is not checkable; do not write it. For "visual" and "dom" checks, actions MUST be an empty array.
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
      items: {
        type: "object", additionalProperties: false,
        properties: {
          text: { type: "string" },
          check: { type: "string", enum: ["visual", "dom", "interaction"] },
          actions: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              properties: { kind: { type: "string", enum: ["click", "type", "wait"] }, target: { type: "string" }, value: { type: "string" } },
              required: ["kind", "target", "value"],
            },
          },
        },
        required: ["text", "check", "actions"],
      },
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
  acceptance: { text: string; check: "visual" | "dom" | "interaction"; actions?: AcceptanceAction[] }[];
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
  // Real columns beat invented ones: entities should come from the actual file.
  if (req.datasetNote) parts.push(req.datasetNote + "\n\nBase the \"entities\" field on these real columns, and make the acceptance criteria refer to values that actually appear in the data.");
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
      { text: "the page renders without a blank screen or a runtime error", check: "visual", actions: [] },
      { text: `the page is recognisably ${title.toLowerCase()}`, check: "visual", actions: [] },
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
      // Actions only mean anything for an interaction check, and three is plenty.
      actions: a.check === "interaction" ? (a.actions || []).slice(0, 3) : undefined,
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

// ---------------------------------------------------------------------------
// Follow-ups that understand context
// ---------------------------------------------------------------------------
// A follow-up used to be appended to the codegen prompt verbatim, so "make it
// bigger" arrived with no idea what "it" was. This resolves the reference against
// the Brief and the current files, decides how much of the Brief the request
// actually changes, and flags anything that contradicts a fork the user already
// settled — so a casual edit can't silently undo a decision they made by looking.

export type FollowUpKind = "tweak" | "feature" | "pivot";

export interface FollowUpPlan {
  kind: FollowUpKind;
  // The request restated so a code generator needs no other context: references
  // resolved, the target named, the change made concrete.
  rewrite: string;
  // Contradictions with a kept decision or an existing acceptance item.
  conflicts: string[];
  // How the Brief's checklist should move. A tweak moves nothing.
  newAcceptance: { text: string; check: "visual" | "dom" | "interaction" }[];
  droppedAcceptance: string[]; // acceptance ids this request makes untrue on purpose
}

const FOLLOWUP_SYSTEM = `You are the intent layer for Riff, an AI app builder. An app already exists and is running. The user has just asked for a change.

Your job is to work out what they actually mean, in the context of the app that exists, and hand a code generator an instruction it can act on with no other context.

Classify the request:
- "tweak": a small change to how something already there looks or behaves. Does not change what the app is for or what it can do. Most follow-ups are tweaks.
- "feature": adds or removes a capability. The app is still the same app.
- "pivot": changes what the app fundamentally is, who it is for, or its data model.

Write "rewrite": the request restated as a direct, concrete instruction. Resolve every vague reference ("it", "that", "the button", "bigger") against the current files and the brief — name the element, the file, and where you can, the actual values. Never invent a requirement the user did not ask for. If the request is already precise, restate it plainly.

Write "conflicts": one short PLAIN SENTENCE for each thing this request would undo that the user previously chose on purpose — a decision they settled, or an existing criterion it would make false. Never include ids, brackets or quotes from the criteria; write it as you would say it out loud ("this removes the Start button you asked for earlier"). Only real contradictions. Usually empty.

Write "newAcceptance": checks that must now be true and were not before. Empty for a tweak.

Write "droppedAcceptance": the exact ids of existing acceptance criteria this request deliberately makes obsolete.
THIS IS NOT OPTIONAL WHEN YOU REPORT A CONFLICT. The user is in charge: if they ask to remove or replace something, every criterion that depends on it is now wrong and MUST be listed here. A conflict is a heads-up to the user, never a veto — if you flag a conflict but leave the stale criterion in place, an automated checker will keep trying to undo what the user just asked for. Still never drop a criterion merely because it is unrelated to this request.`;

const FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["tweak", "feature", "pivot"] },
    rewrite: { type: "string" },
    conflicts: { type: "array", items: { type: "string" } },
    newAcceptance: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, check: { type: "string", enum: ["visual", "dom", "interaction"] } }, required: ["text", "check"] },
    },
    droppedAcceptance: { type: "array", items: { type: "string" } },
  },
  required: ["kind", "rewrite", "conflicts", "newAcceptance", "droppedAcceptance"],
} as const;

export interface FollowUpRequest {
  prompt: string;
  brief: Brief;
  framework: FrameworkSpec;
  existingAppFiles: FileEntry[];
  recentMessages: { role: string; text: string }[];
}

function followUpPrompt(req: FollowUpRequest): string {
  const b = req.brief;
  const parts = [
    `The app: ${b.title} — ${b.oneLiner} (for ${b.audience}).`,
    `It currently must satisfy:\n${b.acceptance.map((a) => `[${a.id}] ${a.text}`).join("\n")}`,
  ];
  if (b.decisions.length)
    parts.push(`Decisions the user already made on purpose — do not quietly undo these:\n${b.decisions.map((d) => `- ${d.readingLabel}${d.directive ? `: ${d.directive}` : ""}`).join("\n")}`);
  if (req.recentMessages.length)
    parts.push(`Recent conversation:\n${req.recentMessages.map((m) => `${m.role}: ${m.text}`).join("\n")}`);
  if (req.existingAppFiles.length)
    parts.push(`Current app source:\n${req.existingAppFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n").slice(0, 24000)}`);
  parts.push(`The user now says: ${req.prompt}`);
  return parts.join("\n\n");
}

// Never throws: a failed interpretation falls back to passing the request through
// untouched, which is exactly how Riff behaved before this existed.
export async function interpretFollowUp(req: FollowUpRequest): Promise<FollowUpPlan> {
  const fallback: FollowUpPlan = { kind: "feature", rewrite: req.prompt, conflicts: [], newAcceptance: [], droppedAcceptance: [] };
  try {
    let raw: FollowUpPlan;
    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const r = await client.chat.completions.create({
        model: OPENAI_FAST,
        messages: [{ role: "system", content: FOLLOWUP_SYSTEM }, { role: "user", content: followUpPrompt(req) }],
        response_format: { type: "json_schema", json_schema: { name: "riff_followup", strict: true, schema: FOLLOWUP_SCHEMA } },
        max_completion_tokens: 1200,
      });
      const c = r.choices[0]?.message?.content;
      if (!c) return fallback;
      raw = JSON.parse(c) as FollowUpPlan;
    } else if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: ANTHROPIC_FAST, max_tokens: 1200, system: FOLLOWUP_SYSTEM,
        tools: [{ name: "plan_followup", description: "Interpret the user's follow-up request.", input_schema: FOLLOWUP_SCHEMA as unknown as Anthropic.Tool.InputSchema }],
        tool_choice: { type: "tool", name: "plan_followup" },
        messages: [{ role: "user", content: followUpPrompt(req) }],
      });
      const tu = msg.content.find((b) => b.type === "tool_use");
      if (!tu || tu.type !== "tool_use") return fallback;
      raw = tu.input as FollowUpPlan;
    } else {
      return fallback;
    }
    return {
      kind: raw.kind || "feature",
      rewrite: (raw.rewrite || "").trim() || req.prompt,
      // Belt and braces: ids are an implementation detail and must never reach the UI.
      conflicts: (raw.conflicts || []).filter(Boolean).map((c) => c.replace(/\[[a-z0-9]+\]\s*/gi, "").trim()).filter(Boolean).slice(0, 3),
      newAcceptance: (raw.newAcceptance || []).slice(0, 4),
      droppedAcceptance: (raw.droppedAcceptance || []).slice(0, 4),
    };
  } catch {
    return fallback;
  }
}

// Move the Brief's checklist without regenerating the whole thing. A tweak leaves
// it untouched; a pivot is handled by the caller with a full regeneration.
export function applyFollowUp(brief: Brief, plan: FollowUpPlan): Brief {
  if (plan.kind === "tweak" || (!plan.newAcceptance.length && !plan.droppedAcceptance.length)) return brief;
  const now = Date.now();
  const dropped = new Set(plan.droppedAcceptance);
  const kept = brief.acceptance.filter((a) => !dropped.has(a.id));
  const added = plan.newAcceptance.map((a, i) => ({ id: `ac${now.toString(36)}${i}`, text: a.text, check: a.check }));
  return { ...brief, acceptance: [...kept, ...added].slice(0, 10), updatedAt: now };
}
