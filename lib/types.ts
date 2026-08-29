export type ProjectStatus =
  | "new" | "booting" | "generating" | "installing" | "starting"
  | "checking" | "live" | "error";

export type FrameworkId = "vite-react" | "static" | "next";

export interface FileEntry { path: string; content: string; }

export interface AgentStep {
  id: string;
  kind: "plan" | "write" | "install" | "start" | "check" | "fix" | "done" | "error" | "log" | "db";
  label: string;
  detail?: string;
  ts: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

// A restorable point in the project's history — the full source snapshot after a
// successful build. Time-travel is "write these files back + restart", so it works
// even after the underlying microVM has been reaped and re-booted.
export interface Checkpoint {
  id: string;
  label: string;      // e.g. "v3"
  message: string;    // what this build did (codegen summary)
  prompt: string;     // the user prompt that produced it
  files: FileEntry[]; // full app-source snapshot at this point
  createdAt: number;
}

export interface DatabaseInfo {
  id: string;                 // pandastack database id
  status: string;             // provisioning | running | error
  connectionUrl?: string;     // postgres://… (injected into the app as DATABASE_URL)
  createdAt: number;
}

// --- Fork-to-explore (P3): branch a running app + its DB into N live variants ---

export type BranchStatus =
  | "spawning" | "cloning-db" | "generating" | "starting" | "checking"
  | "live" | "error" | "kept" | "discarded";

// One live variant: a CoW-forked child sandbox running a divergent codegen.
export interface Branch {
  id: string;                 // "b"+ts+"_"+i
  roundId: string;
  label: string;              // "A" | "B" | "C" | "D"
  directive: string;          // the divergent per-branch prompt (shown on the card)
  parentSandboxId: string;    // trunk (or a parent branch) sandbox that was forked
  sandboxId: string | null;   // forked child (null until forkSandbox returns)
  snapshotId?: string;        // fork provenance
  databaseId?: string | null; // cloned DB id (full-stack only)
  databaseUrl?: string | null;// clone connection_url injected as DATABASE_URL
  status: BranchStatus;
  previewUrl: string | null;
  summary?: string;
  error?: string;
  files: FileEntry[];         // divergent app-source (powers keep-merge + future diff)
  createdAt: number;
}

// A fan-out round: one base prompt → N branches forked off the trunk at a point in time.
export interface BranchRound {
  id: string;                 // "r"+ts
  basePrompt: string;
  fromSandboxId: string;      // trunk sandbox forked (for teardown on keep)
  fromDatabaseId?: string | null;
  baselineFiles: FileEntry[]; // appSrcFiles at fork time — keep-merge base + diff baseline
  baseCheckpointId?: string;
  branchIds: string[];
  keptBranchId?: string;
  createdAt: number;
}

export interface Project {
  id: string;                 // riff project id
  name: string;
  sandboxId: string | null;   // pandastack sandbox id
  status: ProjectStatus;
  previewUrl: string | null;
  port: number;
  framework: FrameworkId;
  files: FileEntry[];
  checkpoints: Checkpoint[];
  database?: DatabaseInfo | null;
  messages: ChatMessage[];
  steps: AgentStep[];
  // Fork-to-explore (all optional → old projects load unchanged as single-preview mode).
  branches?: Branch[];           // append-only fork history across rounds
  rounds?: BranchRound[];
  activeRoundId?: string | null; // non-null ⇒ the compare grid is showing, not the single preview
  pendingDbDeletes?: string[];   // old source DBs awaiting deletion (blocked until their clone is independent)
  error?: string;
  createdAt: number;
  updatedAt: number;
}
