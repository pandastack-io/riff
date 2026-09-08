// Does the live app do what the user MEANT?
//
// Today "live" means the preview host answered with a status under 500. That is a
// liveness check, not a correctness one: a blank page, a crashed component, or an
// app that simply forgot the pause button all report "Live". This module closes
// that gap by looking at the RUNNING app and checking it against the Brief's
// acceptance list, then feeding the misses back into the agent's existing self-fix
// loop as ordinary feedback.
//
// Evidence is captured by driving the system Chrome in headless mode over the
// preview URL — no new npm dependency, no bundled browser, and nothing to install
// on a self-hosted box that already has Chrome. If Chrome is not found we report
// "unverifiable" honestly rather than guessing.
import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AcceptanceItem, AcceptanceVerdict } from "./types";

const SHOT_W = 1024, SHOT_H = 768;
const CHROME_TIMEOUT = 45000;

export function verifyEnabled(): boolean {
  if (process.env.RIFF_VERIFY === "0") return false;
  // A judge needs a vision-capable model. With no key at all (template codegen)
  // there is nothing to judge with, so verification is skipped.
  return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// --- finding Chrome ----------------------------------------------------------

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

let chromeCache: string | null | undefined;
export async function findChrome(): Promise<string | null> {
  if (chromeCache !== undefined) return chromeCache;
  const tried = [process.env.CHROME_PATH, ...CANDIDATES].filter(Boolean) as string[];
  for (const p of tried) {
    try { await fs.access(p); chromeCache = p; return p; } catch { /* keep looking */ }
  }
  chromeCache = null;
  return null;
}

function run(bin: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024, killSignal: "SIGKILL" }, (_err, stdout, stderr) => {
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function baseFlags(): string[] {
  const f = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-sync",
    `--window-size=${SHOT_W},${SHOT_H}`,
  ];
  // Chrome's own sandbox stays ON by default — the page being rendered is
  // model-generated code. Self-hosters running the orchestrator as root in a
  // container (where the sandbox cannot start) opt out explicitly.
  if (process.env.RIFF_VERIFY_NO_SANDBOX === "1") f.push("--no-sandbox", "--disable-dev-shm-usage");
  if (process.env.RIFF_VERIFY_INSECURE === "1") f.push("--ignore-certificate-errors");
  return f;
}

// --- evidence ----------------------------------------------------------------

export interface Evidence {
  screenshot?: Buffer;
  visibleText: string;
  blank: boolean;
  errorOverlay: string | null; // the dev-server error, when the page is showing one
}

// Strip a serialized DOM down to the text a person would actually see.
function textFromDom(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// Vite and Next both render their build/runtime errors INTO the page, so the DOM
// is a reliable channel for "the app is up but broken".
function findErrorOverlay(html: string, text: string): string | null {
  const markers: [RegExp, string][] = [
    [/<vite-error-overlay/i, "Vite error overlay"],
    [/Failed to compile/i, "Failed to compile"],
    [/Unhandled Runtime Error/i, "Unhandled runtime error"],
    [/Build Error/i, "Build error"],
    [/Internal Server Error/i, "Internal server error"],
    [/ReferenceError:|TypeError:|SyntaxError:/, "Uncaught JavaScript error"],
  ];
  for (const [re, label] of markers) {
    if (re.test(html)) {
      const m = /((?:ReferenceError|TypeError|SyntaxError|Error)[^<\n]{0,180})/.exec(text);
      return m ? `${label} — ${m[1].trim()}` : label;
    }
  }
  return null;
}

export async function captureEvidence(url: string): Promise<Evidence | null> {
  const chrome = await findChrome();
  if (!chrome) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "riff-verify-"));
  const shot = path.join(dir, "shot.png");
  const profile = path.join(dir, "profile");
  try {
    // Two passes over the same URL: one paints a screenshot, one serializes the
    // DOM after scripts have run. Both are bounded; a hang yields no evidence
    // rather than stalling the build.
    const flags = [...baseFlags(), `--user-data-dir=${profile}`, "--virtual-time-budget=8000"];
    const [, dom] = await Promise.all([
      run(chrome, [...flags, `--screenshot=${shot}`, url], CHROME_TIMEOUT),
      run(chrome, [...baseFlags(), `--user-data-dir=${profile}-dom`, "--virtual-time-budget=8000", "--dump-dom", url], CHROME_TIMEOUT),
    ]);
    let screenshot: Buffer | undefined;
    try { screenshot = await fs.readFile(shot); } catch { /* no screenshot is survivable */ }

    const html = dom.stdout || "";
    const visibleText = textFromDom(html);
    const hasVisual = /<(img|canvas|svg|video|input|button)\b/i.test(html);
    return {
      screenshot,
      visibleText: visibleText.slice(0, 4000),
      blank: visibleText.length < 12 && !hasVisual,
      errorOverlay: findErrorOverlay(html, visibleText),
    };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- the judge ---------------------------------------------------------------

const JUDGE_SYSTEM = `You are the acceptance checker for Riff, an AI app builder.

You are given a screenshot and the visible text of a web app that was just generated, plus the acceptance criteria it was supposed to satisfy. For EACH criterion, decide:
- "pass": the evidence clearly shows it is true.
- "fail": the evidence clearly shows it is false or missing.
- "unverifiable": it cannot be judged from a single static screenshot (for example it needs a click, a timer to elapse, or a login).

Be strict but fair. Judge only what the evidence shows. Do NOT mark something "fail" merely because you cannot see it in a static screenshot — that is "unverifiable". Do mark "fail" when the thing should obviously be visible and plainly is not, when the page is blank, or when an error is on screen.

A LABEL IS NOT THE FEATURE. Text that merely names or promises something does not satisfy a criterion about that thing. "Chart coming soon", a heading reading "Graph showing sales trends" with no plotted data, an empty bordered box captioned "Map", a button that obviously does nothing — all of these are "fail", not "pass". A criterion about a chart, graph, or visualisation is satisfied only by actually drawn marks: bars, a line, plotted points, arcs. Placeholder and lorem content is a "fail" every time.

For every "fail", write a "fix": one concrete, specific instruction to the code generator that would make the criterion true. Name the element and the behaviour. No preamble.`;

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["pass", "fail", "unverifiable"] },
          reason: { type: "string" },
          fix: { type: "string" },
        },
        required: ["id", "status", "reason", "fix"],
      },
    },
  },
  required: ["verdicts"],
} as const;

function judgePrompt(items: AcceptanceItem[], ev: Evidence): string {
  const L = [`Acceptance criteria:\n${items.map((a) => `[${a.id}] ${a.text}`).join("\n")}`];
  if (ev.errorOverlay) L.push(`NOTE: the page is displaying a development error: ${ev.errorOverlay}. Every criterion that depends on the app working should FAIL.`);
  if (ev.blank) L.push(`NOTE: the page rendered essentially no visible content. It is blank.`);
  L.push(`Visible text on the page:\n${ev.visibleText || "(none)"}`);
  L.push(`Return one verdict per criterion, using the exact ids above. Use an empty string for "fix" when the status is not "fail".`);
  return L.join("\n\n");
}

async function judgeOpenAI(items: AcceptanceItem[], ev: Evidence): Promise<AcceptanceVerdict[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: judgePrompt(items, ev) }];
  if (ev.screenshot) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${ev.screenshot.toString("base64")}` } });
  const r = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content }],
    response_format: { type: "json_schema", json_schema: { name: "riff_verdicts", strict: true, schema: JUDGE_SCHEMA } },
    max_completion_tokens: 1500,
  });
  const raw = r.choices[0]?.message?.content;
  if (!raw) throw new Error("verify: openai returned no content");
  return (JSON.parse(raw) as { verdicts: AcceptanceVerdict[] }).verdicts;
}

async function judgeAnthropic(items: AcceptanceItem[], ev: Evidence): Promise<AcceptanceVerdict[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (ev.screenshot) blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: ev.screenshot.toString("base64") } });
  blocks.push({ type: "text", text: judgePrompt(items, ev) });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    max_tokens: 1500,
    system: JUDGE_SYSTEM,
    tools: [{ name: "report_verdicts", description: "Report one verdict per acceptance criterion.", input_schema: JUDGE_SCHEMA as unknown as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: "report_verdicts" },
    messages: [{ role: "user", content: blocks }],
  });
  const tu = msg.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("verify: model did not return report_verdicts");
  return (tu.input as { verdicts: AcceptanceVerdict[] }).verdicts;
}

export interface VerifyResult {
  verdicts: AcceptanceVerdict[];
  ok: boolean;            // nothing failed
  skipped?: string;       // why the pass didn't run, when it didn't
  evidenceNote?: string;  // the hard signal, if any (blank page / error overlay)
}

// Verify a live app against its Brief. Never throws — a broken judge must not
// break a build that is otherwise serving fine.
export async function verifyApp(url: string, acceptance: AcceptanceItem[]): Promise<VerifyResult> {
  if (!verifyEnabled()) return { verdicts: [], ok: true, skipped: "verification disabled" };
  if (!acceptance.length) return { verdicts: [], ok: true, skipped: "no acceptance criteria" };

  let ev: Evidence | null;
  try { ev = await captureEvidence(url); } catch { ev = null; }
  if (!ev) return { verdicts: [], ok: true, skipped: "no headless Chrome found on the server (set CHROME_PATH)" };

  const hard = ev.errorOverlay || (ev.blank ? "the page rendered blank" : null);
  try {
    const raw = process.env.OPENAI_API_KEY ? await judgeOpenAI(acceptance, ev) : await judgeAnthropic(acceptance, ev);
    const byId = new Map(raw.map((v) => [v.id, v]));
    const verdicts: AcceptanceVerdict[] = acceptance.map((a) => {
      const v = byId.get(a.id);
      return v
        ? { id: a.id, status: v.status, reason: v.reason || "", fix: v.fix || undefined }
        : { id: a.id, status: "unverifiable" as const, reason: "the checker did not return a verdict" };
    });
    return { verdicts, ok: !verdicts.some((v) => v.status === "fail"), evidenceNote: hard || undefined };
  } catch {
    // The judge failed. A hard signal from the evidence is still worth reporting.
    if (hard) {
      return {
        verdicts: acceptance.map((a) => ({ id: a.id, status: "fail" as const, reason: hard, fix: `The running page shows: ${hard}. Fix it so the app renders correctly.` })),
        ok: false, evidenceNote: hard,
      };
    }
    return { verdicts: [], ok: true, skipped: "the acceptance checker was unavailable" };
  }
}

// Turn failures into the same kind of feedback string the build-log fix loop uses.
export function verdictsToFeedback(items: AcceptanceItem[], verdicts: AcceptanceVerdict[]): string {
  const byId = new Map(items.map((a) => [a.id, a]));
  const fails = verdicts.filter((v) => v.status === "fail");
  if (!fails.length) return "";
  return (
    "The app runs, but it does not match what the user asked for. Fix these specific problems, and change nothing else:\n" +
    fails.map((v, i) => `${i + 1}. ${byId.get(v.id)?.text ?? v.id}\n   What is wrong: ${v.reason}\n   Fix: ${v.fix || "make this true"}`).join("\n")
  );
}
