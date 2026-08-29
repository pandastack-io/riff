import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { exportToGitHub, githubEnabled } from "@/lib/github";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Export the project's files to a new GitHub repo (one commit). Requires
// GITHUB_TOKEN (repo scope) on the server.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = await store.get(id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!githubEnabled()) return NextResponse.json({ error: "GitHub export is not configured. Set GITHUB_TOKEN (a Personal Access Token with 'repo' scope) on the Riff server." }, { status: 501 });
  if (!project.files.length) return NextResponse.json({ error: "nothing to export yet — build the app first" }, { status: 400 });
  try {
    const res = await exportToGitHub(project.name || `riff-${project.id}`, project.files);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ enabled: githubEnabled() });
}
