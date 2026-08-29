// Thin PandaStack REST client — exactly the operations Riff's agent loop needs.
// Verified live against api.pandastack.ai (create 86ms, fs, exec, tokenless
// preview host <port>-<id>.<suffix>, logs).
const API = process.env.PANDASTACK_API_URL || "https://api.pandastack.ai";
const KEY = process.env.PANDASTACK_API_KEY || "";
const SUFFIX = process.env.PANDASTACK_PREVIEW_SUFFIX || "pandastack.ai";

function must(): string {
  if (!KEY) throw new Error("PANDASTACK_API_KEY is not set (see .env.local.example)");
  return KEY;
}
async function req(method: string, path: string, body?: unknown, raw?: BodyInit, timeoutMs = 30000): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${must()}` };
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  // Always bound the request — a hung DELETE/GET must not stall teardown or a round.
  return fetch(API + path, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
}

export interface ExecResult { stdout: string; stderr: string; exit_code: number; }

export const pandastack = {
  previewUrl(sandboxId: string, port: number): string {
    return `https://${port}-${sandboxId}.${SUFFIX}/`;
  },

  async createSandbox(template = "base"): Promise<{ id: string; boot_ms?: number }> {
    const r = await req("POST", "/v1/sandboxes", { template, persistent: true });
    if (!r.ok) throw new Error(`create sandbox: ${r.status} ${await r.text()}`);
    return r.json();
  },

  async deleteSandbox(id: string): Promise<void> {
    await req("DELETE", `/v1/sandboxes/${id}`).catch(() => {});
  },

  // Is this sandbox still around and runnable? Sandboxes can be reaped/hibernated
  // out from under us, so every turn re-checks before trusting a stored id.
  async isAlive(id: string): Promise<boolean> {
    const s = await this.sandboxStatus(id);
    return s === "running" || s === "paused" || s === "hibernated";
  },
  // Raw status string, or null if the sandbox is gone.
  async sandboxStatus(id: string): Promise<string | null> {
    try {
      const r = await req("GET", `/v1/sandboxes/${id}`);
      if (!r.ok) return null;
      return ((await r.json()) as { status?: string }).status ?? null;
    } catch { return null; }
  },

  // Scale-to-zero: hibernate a running sandbox (snapshot + pause → ~$0 idle) and
  // wake it (~1–2s, memory+disk state intact — the dev server keeps running).
  async hibernateSandbox(id: string): Promise<boolean> {
    // Snapshotting a real app VM's memory can take ~30–45s; give it room.
    try { const r = await req("POST", `/v1/sandboxes/${id}/hibernate`, {}, undefined, 90000); return r.ok; }
    catch { return false; }
  },
  async wakeSandbox(id: string): Promise<boolean> {
    try { const r = await req("POST", `/v1/sandboxes/${id}/wake`, {}, undefined, 60000); return r.ok; }
    catch { return false; }
  },

  // CoW-fork a sandbox (~0.7s, same-host disk reflink). The child inherits the
  // parent's ENTIRE disk (files + node_modules) but COLD-BOOTS — no running
  // process survives, so the caller must restart the dev server. Returns the new
  // child id. Each call makes one child, so N calls → N branches of one parent.
  async forkSandbox(id: string): Promise<{ childId: string; snapshotId?: string }> {
    const r = await req("POST", `/v1/sandboxes/${id}/fork`, { persistent: true });
    if (!r.ok) throw new Error(`fork sandbox: ${r.status} ${await r.text()}`);
    const d = (await r.json()) as { children?: string[]; snapshot_id?: string };
    const childId = d.children?.[d.children.length - 1];
    if (!childId) throw new Error("fork returned no child id");
    return { childId, snapshotId: d.snapshot_id };
  },

  // --- managed Postgres (one per project) ---
  async createDatabase(label: string): Promise<{ id: string }> {
    const r = await req("POST", "/v1/databases", { label });
    if (!r.ok) throw new Error(`create database: ${r.status} ${await r.text()}`);
    return r.json();
  },
  async getDatabase(id: string): Promise<{ id: string; status: string; connection_url?: string }> {
    const r = await req("GET", `/v1/databases/${id}`);
    if (!r.ok) throw new Error(`get database: ${r.status} ${await r.text()}`);
    return r.json();
  },
  // Clone a database into a NEW database id (point-in-time copy of the source).
  // Async — returns the new id; poll getDatabase until it reports running.
  async cloneDatabase(sourceId: string, label: string): Promise<{ id: string }> {
    const r = await req("POST", `/v1/databases/${sourceId}/clone`, { label });
    if (!r.ok) throw new Error(`clone database: ${r.status} ${await r.text()}`);
    return r.json();
  },
  // Returns true only if the DB is actually GONE. The platform can 409 (a clone
  // still provisions from this source's backups) OR 2xx a delete it can't yet
  // honor, so we verify with a follow-up GET rather than trusting the response.
  async deleteDatabase(id: string): Promise<boolean> {
    try {
      const r = await req("DELETE", `/v1/databases/${id}`);
      if (r.status === 404) return true;
      await new Promise((res) => setTimeout(res, 1500));
      const g = await req("GET", `/v1/databases/${id}`);
      return g.status === 404;
    } catch { return false; }
  },

  async writeFile(id: string, path: string, content: string): Promise<void> {
    const r = await req("PUT", `/v1/sandboxes/${id}/fs?path=${encodeURIComponent(path)}`, undefined, content);
    if (!r.ok) throw new Error(`write ${path}: ${r.status} ${await r.text()}`);
  },

  // Write raw bytes (e.g. a generated PNG) into the sandbox filesystem.
  async writeFileBytes(id: string, path: string, bytes: Uint8Array): Promise<void> {
    const body = new Uint8Array(bytes); // ensure a plain ArrayBuffer-backed view for fetch
    const r = await req("PUT", `/v1/sandboxes/${id}/fs?path=${encodeURIComponent(path)}`, undefined, body);
    if (!r.ok) throw new Error(`write bytes ${path}: ${r.status} ${await r.text()}`);
  },

  async exec(id: string, cmd: string, timeoutMs = 180000): Promise<ExecResult> {
    const ctl = AbortSignal.timeout(timeoutMs);
    const r = await fetch(`${API}/v1/sandboxes/${id}/exec`, {
      method: "POST",
      headers: { Authorization: `Bearer ${must()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
      signal: ctl,
    });
    if (!r.ok) throw new Error(`exec: ${r.status} ${await r.text()}`);
    return r.json();
  },

  // Poll the tokenless preview host until the dev server answers (any non-5xx-from-proxy).
  async waitForServing(sandboxId: string, port: number, budgetMs = 90000): Promise<{ ok: boolean; ms: number; lastCode: number }> {
    const url = this.previewUrl(sandboxId, port);
    const t0 = Date.now();
    let lastCode = 0;
    while (Date.now() - t0 < budgetMs) {
      try {
        const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(6000), redirect: "manual" });
        lastCode = r.status;
        // The app is serving iff we get a real answer from it (200/3xx/404, all
        // < 500). A dead upstream port makes the preview proxy return 502/503/504,
        // so anything ≥ 500 is "not up yet" — never treat a proxy 5xx (even its
        // HTML error page) as live. That false-positive is what once reported
        // "Live" while the server was actually down.
        if (r.status < 500) {
          return { ok: true, ms: Date.now() - t0, lastCode };
        }
      } catch { /* not up yet */ }
      await new Promise((res) => setTimeout(res, 700));
    }
    return { ok: false, ms: Date.now() - t0, lastCode };
  },
};
