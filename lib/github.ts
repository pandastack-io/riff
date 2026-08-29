import type { FileEntry } from "./types";

// Minimal GitHub export: create a repo and push the project's files as one clean
// commit via the Git Data API. Uses a Personal Access Token (GITHUB_TOKEN, repo
// scope) — the token never leaves the server. This is the "no lock-in" export
// half of two-way sync; pull/round-trip is a follow-on.
const API = "https://api.github.com";

export function githubEnabled(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

async function gh(path: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(path.startsWith("http") ? path : API + path, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "riff-builder",
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers || {}),
    },
  });
}

async function json<T>(r: Response, ctx: string): Promise<T> {
  if (!r.ok) throw new Error(`github ${ctx}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

// Create a repo (or reuse an existing one owned by the user) and push files as a
// single commit onto its default branch. Returns the repo's html_url.
export async function exportToGitHub(name: string, files: FileEntry[]): Promise<{ url: string; owner: string; repo: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set — add a GitHub Personal Access Token (repo scope) to enable export.");
  const repo = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "riff-app";

  const me = await json<{ login: string }>(await gh("/user", { token, method: "GET" }), "whoami");
  const owner = me.login;

  // Create the repo (auto_init gives us a base commit/tree to build on).
  let branch = "main";
  const createRes = await gh("/user/repos", { token, method: "POST", body: JSON.stringify({ name: repo, private: true, auto_init: true, description: "Built with Riff" }) });
  if (createRes.status === 422) {
    // Already exists — read its default branch.
    const info = await json<{ default_branch: string }>(await gh(`/repos/${owner}/${repo}`, { token, method: "GET" }), "get repo");
    branch = info.default_branch || "main";
  } else {
    const info = await json<{ default_branch: string }>(createRes, "create repo");
    branch = info.default_branch || "main";
    // auto_init is async — wait briefly for the initial ref to exist.
    for (let i = 0; i < 10; i++) {
      const r = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, { token, method: "GET" });
      if (r.ok) break;
      await new Promise((res) => setTimeout(res, 800));
    }
  }

  const ref = await json<{ object: { sha: string } }>(await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, { token, method: "GET" }), "get ref");
  const baseCommitSha = ref.object.sha;
  const baseCommit = await json<{ tree: { sha: string } }>(await gh(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, { token, method: "GET" }), "get base commit");

  // Blob per file, then a tree, then a commit.
  const tree = await Promise.all(files.map(async (f) => {
    const blob = await json<{ sha: string }>(await gh(`/repos/${owner}/${repo}/git/blobs`, {
      token, method: "POST", body: JSON.stringify({ content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" }),
    }), "blob");
    return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
  }));
  const newTree = await json<{ sha: string }>(await gh(`/repos/${owner}/${repo}/git/trees`, {
    token, method: "POST", body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  }), "tree");
  const commit = await json<{ sha: string }>(await gh(`/repos/${owner}/${repo}/git/commits`, {
    token, method: "POST", body: JSON.stringify({ message: "Export from Riff", tree: newTree.sha, parents: [baseCommitSha] }),
  }), "commit");
  await json(await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    token, method: "PATCH", body: JSON.stringify({ sha: commit.sha }),
  }), "update ref");

  return { url: `https://github.com/${owner}/${repo}`, owner, repo };
}
