import type { FileEntry } from "../types";
import type { FrameworkSpec } from "../frameworks";
import { templateProvider } from "./template";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";

export interface CodegenRequest {
  prompt: string;
  framework: FrameworkSpec;      // system prompt + entry file + path allow-list
  existingAppFiles: FileEntry[]; // app-source files from a prior turn (iterative edits)
  feedback?: string;             // build/runtime errors for the fix loop
  dbAttached?: boolean;          // a Postgres database is available to the app
  imageDataUrl?: string;         // a reference image (screenshot/mockup) to reproduce as UI
  redesign?: boolean;            // fork-branch variant: force a visually distinct result
  briefBlock?: string;           // the Brief rendered as a spec (see lib/intent.ts)
}
export interface CodegenResult {
  summary: string;
  files: FileEntry[]; // paths RELATIVE to the app root, filtered to the framework's allow-list
}
export interface CodegenProvider {
  name: string;
  generate(req: CodegenRequest): Promise<CodegenResult>;
}

export function pickProvider(): CodegenProvider {
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  return templateProvider; // deterministic offline fallback
}

// Shared helpers for providers ------------------------------------------------

// The user message: existing files, optional DB note, optional fix feedback, request.
export function buildUserPrompt(req: CodegenRequest): string {
  const parts: string[] = [];
  if (req.existingAppFiles.length)
    parts.push("Current app-source files:\n" + req.existingAppFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n"));
  if (req.briefBlock) parts.push(req.briefBlock);
  if (req.dbAttached && req.framework.dbNote) parts.push(req.framework.dbNote);
  if (req.imageDataUrl) parts.push("A reference image is attached. Reproduce its layout, structure, spacing, colors, and typography as faithfully as possible in code, then apply the user's request on top.");
  if (req.redesign) parts.push("THIS IS A REDESIGN / VARIANT TASK. You MUST return a visually DISTINCT result from the current files — commit fully to the requested direction across layout, color, typography, spacing, shapes, and motion. Keep the same core content and purpose, but do NOT return the existing files unchanged or only lightly tweaked. Rewrite the styling wholesale to realize the direction.");
  if (req.feedback) parts.push(`The app failed to run. Fix it. Build/runtime output:\n${req.feedback}`);
  parts.push(`User request: ${req.prompt}`);
  return parts.join("\n\n");
}

// Keep only files the framework permits, and check the model returned something
// runnable. The entry file is mandatory ONLY when the app does not exist yet: on
// an edit or a targeted fix the model rightly returns just the files it changed,
// and the entry file is already on the sandbox. Demanding it back every time
// forces needless full rewrites and fails perfectly good one-file patches.
export function acceptFiles(req: CodegenRequest, files: { path: string; content: string }[]): FileEntry[] {
  const kept = files.filter((f) => f.path && req.framework.allowPath(f.path));
  if (!kept.length) throw new Error("model returned no files it is allowed to write");
  if (!req.existingAppFiles.length && !kept.some((f) => f.path === req.framework.entryFile))
    throw new Error(`model did not produce ${req.framework.entryFile}`);
  return kept;
}
