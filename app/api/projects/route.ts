import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { detectFramework } from "@/lib/frameworks";
import type { Project, FrameworkId } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: FrameworkId[] = ["vite-react", "static", "next"];

export async function GET() {
  return NextResponse.json({ projects: await store.list() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name: string = body?.name || "";
  // Explicit framework wins; "auto" (or missing) detects from the prompt/name.
  const framework: FrameworkId = VALID.includes(body?.framework)
    ? body.framework
    : detectFramework(name);
  const id = "p_" + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  const project: Project = {
    id, name: name?.trim() || "Untitled", sandboxId: null, status: "new",
    previewUrl: null, port: 3000, framework,
    files: [], checkpoints: [], database: null,
    messages: [], steps: [], createdAt: now, updatedAt: now,
  };
  await store.put(project);
  return NextResponse.json(project);
}
