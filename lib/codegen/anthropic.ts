import Anthropic from "@anthropic-ai/sdk";
import type { CodegenProvider, CodegenRequest, CodegenResult } from "./index";
import { acceptFiles } from "./index";

// Real AI codegen via the official Anthropic SDK. Structured output is obtained
// with a forced tool call (write_app) so we always get a clean {summary, files}
// object. The system prompt and the writable path set come from the project's
// framework spec, so the fixed build harness can't be broken by generation.
//
// Prompt caching: cache_control breakpoints on the two stable, expensive chunks —
// the system prompt (identical every turn for a framework) and the existing-files
// context (identical across a build's fix-loop retries and the anti-echo redo).
// Cached input tokens bill at ~10% of the normal rate, so multi-turn editing and
// self-fix loops get dramatically cheaper.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

const TOOL: Anthropic.Tool = {
  name: "write_app",
  description: "Emit the complete set of app-source files.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two sentences on what you built/changed, for the chat." },
      files: {
        type: "array",
        description: "Every app-source file to write, full contents.",
        items: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    },
    required: ["summary", "files"],
  },
};

// The user message as content blocks, with a cache breakpoint on the (stable,
// large) existing-files block.
function userBlocks(req: CodegenRequest): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];
  if (req.existingAppFiles.length) {
    blocks.push({
      type: "text",
      text: "Current app-source files:\n" + req.existingAppFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n"),
      cache_control: { type: "ephemeral" },
    });
  }
  // The brief is stable across a build's fix-loop retries, so it rides the cache.
  if (req.briefBlock) blocks.push({ type: "text", text: req.briefBlock, cache_control: { type: "ephemeral" } });
  if (req.dbAttached && req.framework.dbNote) blocks.push({ type: "text", text: req.framework.dbNote });
  if (req.imageDataUrl) blocks.push({ type: "text", text: "A reference image is attached. Reproduce its layout, structure, spacing, colors, and typography as faithfully as possible in code, then apply the user's request on top." });
  if (req.redesign) blocks.push({ type: "text", text: "THIS IS A REDESIGN / VARIANT TASK. You MUST return a visually DISTINCT result from the current files — commit fully to the requested direction across layout, color, typography, spacing, shapes, and motion. Keep the same core content and purpose, but do NOT return the existing files unchanged." });
  if (req.feedback) blocks.push({ type: "text", text: `The app failed to run. Fix it. Build/runtime output:\n${req.feedback}` });
  blocks.push({ type: "text", text: `User request: ${req.prompt}` });
  return blocks;
}

export const anthropicProvider: CodegenProvider = {
  name: `anthropic:${MODEL}`,
  async generate(req: CodegenRequest): Promise<CodegenResult> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        // Cache the tools + system prefix (identical every turn for this framework).
        system: [{ type: "text", text: req.framework.codegenSystem, cache_control: { type: "ephemeral" } }],
        tools: [TOOL],
        tool_choice: { type: "tool", name: "write_app" },
        messages: [{ role: "user", content: userBlocks(req) }],
      })
      .finalMessage();

    const tu = msg.content.find((b) => b.type === "tool_use");
    if (!tu || tu.type !== "tool_use") throw new Error("model did not return the write_app tool");
    const input = tu.input as { summary?: string; files?: { path: string; content: string }[] };
    const files = acceptFiles(req, input.files || []);
    return { summary: input.summary || "Updated the app.", files };
  },
};
