// Durable project store backed by SQLite (better-sqlite3). A real transactional
// database, but zero-ops: a single file at .riff/riff.db, no server to run — the
// natural upgrade from the old JSON file for a self-hostable builder. The whole
// Project is kept as a JSON document in `data`, with id/name/framework/status/
// updated_at split out as indexed columns so listing and lookups are cheap.
//
// The interface stays async (callers `await`) even though better-sqlite3 is
// synchronous; being sync + transactional is exactly why concurrent branch saves
// can't corrupt or clobber each other — no serialize lock needed anymore.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { Project } from "./types";

const DIR = path.join(process.cwd(), ".riff");
const FILE = path.join(DIR, "riff.db");

// Cache the connection on globalThis so Next.js dev HMR doesn't open a new handle
// (and re-run migrations) on every module reload.
const g = globalThis as unknown as { __riffDb?: Database.Database };

function db(): Database.Database {
  if (g.__riffDb) return g.__riffDb;
  fs.mkdirSync(DIR, { recursive: true });
  const d = new Database(FILE);
  d.pragma("journal_mode = WAL");
  d.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    framework TEXT,
    status TEXT,
    updated_at INTEGER,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);`);
  // One-time import of any legacy JSON store, so existing users don't lose history.
  try {
    const legacy = path.join(DIR, "projects.json");
    if (fs.existsSync(legacy) && (d.prepare("SELECT COUNT(*) c FROM projects").get() as { c: number }).c === 0) {
      const all = JSON.parse(fs.readFileSync(legacy, "utf8")) as Record<string, Project>;
      const ins = d.prepare("INSERT OR REPLACE INTO projects(id,name,framework,status,updated_at,data) VALUES(@id,@name,@framework,@status,@updated_at,@data)");
      const tx = d.transaction((ps: Project[]) => { for (const p of ps) ins.run(row(p)); });
      const rows = Object.values(all);
      if (rows.length) tx(rows);
    }
  } catch { /* best-effort migration */ }
  g.__riffDb = d;
  return d;
}

function row(p: Project) {
  return { id: p.id, name: p.name, framework: p.framework, status: p.status, updated_at: p.updatedAt, data: JSON.stringify(p) };
}
function parse(r: { data: string } | undefined): Project | null {
  return r ? (JSON.parse(r.data) as Project) : null;
}

export const store = {
  async get(id: string): Promise<Project | null> {
    return parse(db().prepare("SELECT data FROM projects WHERE id = ?").get(id) as { data: string } | undefined);
  },
  async list(): Promise<Project[]> {
    return (db().prepare("SELECT data FROM projects ORDER BY updated_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Project);
  },
  async put(p: Project): Promise<void> {
    p.updatedAt = Date.now();
    db().prepare("INSERT OR REPLACE INTO projects(id,name,framework,status,updated_at,data) VALUES(@id,@name,@framework,@status,@updated_at,@data)").run(row(p));
  },
  async del(id: string): Promise<void> {
    db().prepare("DELETE FROM projects WHERE id = ?").run(id);
  },
  // Atomic read-modify-write in a single SQLite transaction: read the latest row,
  // apply `fn`, write it back — so a minutes-long fork round updates only its own
  // fields without clobbering a concurrent keep/discard or DB attach.
  async mutate(id: string, fn: (p: Project) => void): Promise<Project | null> {
    const d = db();
    const tx = d.transaction((): Project | null => {
      const p = parse(d.prepare("SELECT data FROM projects WHERE id = ?").get(id) as { data: string } | undefined);
      if (!p) return null;
      fn(p);
      p.updatedAt = Date.now();
      d.prepare("UPDATE projects SET name=@name, framework=@framework, status=@status, updated_at=@updated_at, data=@data WHERE id=@id").run(row(p));
      return p;
    });
    return tx();
  },
};
