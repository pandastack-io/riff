import OpenAI from "openai";
import type { CodegenProvider, CodegenRequest, CodegenResult } from "./index";
import { buildUserPrompt, acceptFiles } from "./index";

// Real AI codegen via OpenAI. Structured Outputs (json_schema, strict) guarantee
// a clean {summary, files} object every time. The system prompt and the set of
// files the model may write come from the project's framework spec, so the fixed
// build harness can never be broken by generation.
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const SCHEMA = {
  name: "riff_app",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string", description: "1–2 sentences on what you built/changed, for the chat." },
      files: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    },
    required: ["summary", "files"],
  },
} as const;

export const openaiProvider: CodegenProvider = {
  name: `openai:${MODEL}`,
  async generate(req: CodegenRequest): Promise<CodegenResult> {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // When a reference image is attached (image-to-code), send a multimodal
    // message so the vision model can reproduce the design.
    const userContent: OpenAI.Chat.ChatCompletionUserMessageParam["content"] = req.imageDataUrl
      ? [
          { type: "text", text: buildUserPrompt(req) },
          { type: "image_url", image_url: { url: req.imageDataUrl } },
        ]
      : buildUserPrompt(req);
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        // System prompt first + stable → OpenAI caches this prefix automatically
        // (cached input bills at 50%). prompt_cache_key routes same-framework
        // requests to the same cache for better hit rates. No opt-in needed.
        { role: "system", content: req.framework.codegenSystem },
        { role: "user", content: userContent },
      ],
      prompt_cache_key: `riff-${req.framework.id}`,
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_completion_tokens: 16000,
    });
    const raw = r.choices[0]?.message?.content;
    if (!raw) throw new Error("openai returned no content");
    const parsed = JSON.parse(raw) as { summary?: string; files?: { path: string; content: string }[] };
    const files = acceptFiles(req, parsed.files || []);
    return { summary: parsed.summary || "Updated the app.", files };
  },
};
