import { pandastack } from "./pandastack";
import { store } from "./store";
import { frameworkFor, APP_DIR, type FrameworkSpec } from "./frameworks";
import { pickProvider } from "./codegen";
import { imageGenEnabled, findGenRefs, promptFromSlug, generateImage } from "./imagegen";
import { generateBrief, briefToPrompt, blockingQuestion } from "./intent";
import { verifyEnabled, verifyApp, verdictsToFeedback, type VerifyResult } from "./verify";
import type { Project, AgentStep, FileEntry, Checkpoint, Branch, BranchRound, BranchStatus, Brief } from "./types";

const MAX_GEN_IMAGES = 4;

let seq = 0;
const step = (kind: AgentStep["kind"], label: string, detail?: string): AgentStep =>
  ({ id: `s${Date.now()}_${seq++}`, kind, label, detail, ts: Date.now() });

export type StepSink = (s: AgentStep) => void;

const MAX_FIX = 2;
// One acceptance-driven retry per turn. A judge that is wrong twice in a row must
// not be able to spin the build; the user sees the verdicts either way.
const MAX_SEMANTIC_FIX = 1;

// A decision the user made about one of the Brief's ambiguities. The directive is
// carried inline so it survives the Brief being regenerated on later turns.
export interface BriefDecision { ambiguityId: string; readingLabel: string; directive?: string }

export interface TurnOptions {
  imageDataUrl?: string;
  decisions?: BriefDecision[];
  // Coarse side-channel for events that are not build steps (the Brief card, the
  // acceptance verdicts, the one blocking question).
  onEvent?: (event: string, data: unknown) => void;
}

// Run one build turn: generate, sync, (install), (re)start, verify, self-fix, checkpoint.
export async function runAgentTurn(project: Project, prompt: string, emit: StepSink, opts: TurnOptions = {}): Promise<Project> {
  const provider = pickProvider();
  const fw = frameworkFor(project.framework);
  const push = async (s: AgentStep) => { emit(s); project.steps.push(s); await save(project); };
  const fire = opts.onEvent || (() => {});

  try {
    const dbAttached = !!(project.database && project.database.status === "running");
    const hadTrunk = !!project.sandboxId;
    const resuming = !!opts.decisions?.length;

    // 0. UNDERSTAND FIRST. The Brief says what Riff thinks the user asked for,
    //    before a line of code exists. It runs on a fast model CONCURRENTLY with
    //    the microVM boot, so on the common path it costs no wall-clock at all.
    //    On a resume (the user just answered the one question) the stored Brief is
    //    reused — regenerating it would mint new ambiguity ids and re-ask forever.
    const briefP: Promise<Brief> = resuming && project.brief
      ? Promise.resolve(project.brief)
      : generateBrief({ prompt, framework: fw, existingBrief: project.brief, dbAttached, imageDataUrl: opts.imageDataUrl });
    const sandboxP = ensureSandbox(project, fw, push);
    sandboxP.catch(() => {}); // the real await below is what surfaces a boot failure

    project.brief = await briefP;
    applyDecisions(project.brief, opts.decisions);
    await push(step("brief", `Understood — ${project.brief.title}`, project.brief.oneLiner));
    fire("brief", project.brief);
    await save(project);

    // 1. The ONE question worth blocking on: a high-impact fork in the road, on a
    //    project with nothing live to show yet. Everything else is assumed and
    //    stated, or offered as a live fork once the app is up.
    const q = resuming ? null : blockingQuestion(project.brief, hadTrunk);
    if (q) {
      await sandboxP.catch(() => null); // let the VM finish booting so answering is instant
      project.status = hadTrunk ? "live" : "new";
      await push(step("brief", "One thing before I build", q.question));
      fire("needsInput", { ambiguity: q });
      await save(project);
      return project;
    }

    // 2. Ensure a live sandbox (re-boots if the old one was reaped).
    const { sid, fresh } = await sandboxP;

    // 3. Codegen — against the Brief, not just the raw prompt.
    const briefBlock = briefToPrompt(project.brief);
    project.status = "generating"; await push(step("plan", opts.imageDataUrl ? `Reading your design with ${provider.name}…` : `Generating with ${provider.name}…`));
    let gen = await provider.generate({ prompt, framework: fw, existingAppFiles: appSrcFiles(project, fw), dbAttached, imageDataUrl: opts.imageDataUrl, briefBlock });
    await push(step("write", "Wrote " + gen.files.map((f) => f.path).join(", "), gen.summary));

    // 4. Sync files (scaffold once per fresh sandbox + app source every turn).
    const toWrite: FileEntry[] = fresh ? [...fw.scaffold(), ...gen.files] : gen.files;
    await writeFiles(sid, toWrite);
    project.files = mergeFiles(project.files, toWrite);

    // 5. Install on a fresh sandbox (frameworks that need it).
    if (fresh && fw.install) await installDeps(sid, fw, project, push);
    // 5b. Ensure the Postgres client is present when a database is attached.
    if (dbAttached && fw.id === "next") await ensurePg(sid, push);
    // 5c. Materialize any AI images the generated code references.
    await materializeImages(sid, fw, project, push);

    // 6. (Re)start the dev server, then TWO gates before we call it done:
    //    (a) does it serve at all — the build-log fix loop, as before;
    //    (b) does it match the Brief — the acceptance check, which is new. A
    //        semantic miss is fed back as ordinary feedback, so both gates share
    //        one regenerate-write-restart loop.
    project.status = "starting";
    let attempt = 0;
    let semantic = 0;
    while (true) {
      await restartDevServer(sid, fw, dbAttached ? project.database!.connectionUrl : undefined);
      project.status = "checking"; await push(step("check", "Waiting for the app to serve…"));
      const res = await pandastack.waitForServing(sid, fw.port, 90000);
      if (res.ok) {
        project.previewUrl = pandastack.previewUrl(sid, fw.port);
        project.status = "live";
        const vr = await verifyTurn(project, push, fire);
        if (vr && !vr.ok && semantic < MAX_SEMANTIC_FIX) {
          semantic++;
          const misses = vr.verdicts.filter((v) => v.status === "fail").length;
          await push(step("fix", `${misses} thing${misses === 1 ? "" : "s"} missing from the brief — fixing`, vr.evidenceNote));
          project.status = "generating";
          gen = await provider.generate({
            prompt, framework: fw, existingAppFiles: appSrcFiles(project, fw),
            feedback: verdictsToFeedback(project.brief!.acceptance, vr.verdicts),
            dbAttached, briefBlock,
          });
          await writeFiles(sid, gen.files);
          project.files = mergeFiles(project.files, gen.files);
          await materializeImages(sid, fw, project, push);
          continue;
        }
        captureCheckpoint(project, fw, prompt, gen.summary);
        await push(step("done", `Live in ${(res.ms / 1000).toFixed(1)}s`, project.previewUrl));
        break;
      }
      const log = await tailLog(sid);
      if (attempt >= MAX_FIX) {
        project.status = "error"; project.error = "App did not serve; see build log.";
        await push(step("error", "Could not get the app serving", log.slice(-400)));
        break;
      }
      attempt++;
      await push(step("fix", `Build issue — self-fixing (attempt ${attempt}/${MAX_FIX})`, log.slice(-200)));
      project.status = "generating";
      gen = await provider.generate({ prompt, framework: fw, existingAppFiles: appSrcFiles(project, fw), feedback: log, dbAttached, imageDataUrl: opts.imageDataUrl, briefBlock });
      await writeFiles(sid, gen.files);
      project.files = mergeFiles(project.files, gen.files);
    }

    project.messages.push({ id: `m${Date.now()}`, role: "assistant", text: gen.summary, ts: Date.now() });
    await save(project);
    return project;
  } catch (e: unknown) {
    project.status = "error";
    project.error = e instanceof Error ? e.message : String(e);
    await push(step("error", "Something went wrong", project.error));
    await save(project);
    return project;
  }
}

// Restore a checkpoint: write its source back onto a live sandbox (re-booting if
// needed) and restart. Time-travel works even after the VM was reaped.
export async function restoreCheckpoint(project: Project, checkpointId: string, emit: StepSink): Promise<Project> {
  const fw = frameworkFor(project.framework);
  const push = async (s: AgentStep) => { emit(s); project.steps.push(s); await save(project); };
  const cp = project.checkpoints.find((c) => c.id === checkpointId);
  if (!cp) { project.error = "checkpoint not found"; return project; }
  try {
    await push(step("plan", `Restoring ${cp.label}…`, cp.message));
    const { sid, fresh } = await ensureSandbox(project, fw, push);
    if (fresh && fw.install) { await writeFiles(sid, fw.scaffold()); await installDeps(sid, fw, project, push); }
    // Remove any current source the checkpoint doesn't have, then write the snapshot.
    await clearSource(sid, fw, cp.files);
    await writeFiles(sid, cp.files);
    project.files = mergeFiles(fw.scaffold(), cp.files);
    project.status = "starting";
    const dbUrl = project.database?.status === "running" ? project.database.connectionUrl : undefined;
    await restartDevServer(sid, fw, dbUrl);
    project.status = "checking"; await push(step("check", "Waiting for the app to serve…"));
    const res = await pandastack.waitForServing(sid, fw.port, 90000);
    if (res.ok) {
      project.previewUrl = pandastack.previewUrl(sid, fw.port);
      project.status = "live";
      await push(step("done", `Restored ${cp.label} — live in ${(res.ms / 1000).toFixed(1)}s`, project.previewUrl));
    } else {
      project.status = "error"; project.error = "Restored app did not serve.";
      await push(step("error", "Restore failed to serve", (await tailLog(sid)).slice(-300)));
    }
    project.messages.push({ id: `m${Date.now()}`, role: "assistant", text: `Restored checkpoint ${cp.label}.`, ts: Date.now() });
    await save(project);
    return project;
  } catch (e: unknown) {
    project.status = "error"; project.error = e instanceof Error ? e.message : String(e);
    await push(step("error", "Restore failed", project.error));
    await save(project);
    return project;
  }
}

// ===========================================================================
// Fork-to-explore (P3): one prompt → N live CoW-forked branches → keep the winner
// ===========================================================================

// Coarse per-branch event sink (NOT the AgentStep step-stream): the compare grid
// only needs status/previewUrl transitions, not three interleaved build logs.
export type BranchSink = (event: string, data: unknown) => void;

const noopPush = async (_s: AgentStep) => {};

// Make sure the trunk sandbox is live WITH the app before we fork it. Common case
// (Branch is gated on status==="live") returns instantly; if the trunk was reaped
// we reconstitute the whole app from project.files onto a fresh sandbox first.
async function ensureTrunkLive(project: Project, fw: FrameworkSpec): Promise<string> {
  if (project.sandboxId && await pandastack.isAlive(project.sandboxId)) return project.sandboxId;
  const sb = await pandastack.createSandbox("base");
  project.sandboxId = sb.id;
  await waitForGuest(sb.id);
  await writeFiles(sb.id, project.files); // project.files holds scaffold + source
  if (fw.install) await installDeps(sb.id, fw, project, noopPush);
  const dbUrl = project.database?.status === "running" ? project.database.connectionUrl : undefined;
  if (project.database?.status === "running" && fw.id === "next") await ensurePg(sb.id, noopPush);
  await restartDevServer(sb.id, fw, dbUrl);
  const res = await pandastack.waitForServing(sb.id, fw.port, 90000);
  if (res.ok) { project.previewUrl = pandastack.previewUrl(sb.id, fw.port); project.status = "live"; }
  await save(project);
  return sb.id;
}

// Projects with an in-flight fork round (in-memory; single-process dev server).
// The branch/database routes consult this to refuse conflicting concurrent work.
export const activeRounds = new Set<string>();

// Retry deletion of old source DBs that couldn't be deleted at keep time (the
// platform blocks deleting a DB while a clone still provisions from its backups).
// Best-effort: succeeds once the clone is independent (or the clone is deleted).
export async function reclaimPendingDbs(projectId: string) {
  const p = await store.get(projectId);
  const pending = p?.pendingDbDeletes || [];
  if (!pending.length) return;
  const done: string[] = [];
  await Promise.allSettled(pending.map(async (id) => { if (await pandastack.deleteDatabase(id)) done.push(id); }));
  if (done.length) await store.mutate(projectId, (fp) => { fp.pendingDbDeletes = (fp.pendingDbDeletes || []).filter((x) => !done.includes(x)); });
}

// Fan out N branches from one base prompt. The trunk is only READ (its disk is
// reflinked), never mutated, so its own preview stays live as a zero-risk fallback.
// `resolve` marks the round as answering one of the Brief's open questions: each
// forked branch IS a reading of the prompt, the trunk is the reading already
// built, and whichever tile is kept records the decision on the Brief.
export interface RoundResolve { ambiguityId: string; labels: string[]; trunkLabel: string }

export async function runBranchRound(project: Project, basePrompt: string, directives: string[], emit: BranchSink, resolve?: RoundResolve): Promise<Project> {
  const fw = frameworkFor(project.framework);
  const provider = pickProvider();
  const dirs = directives.map((d) => (d || "").trim()).filter(Boolean).slice(0, 4);
  if (dirs.length < 2) { emit("fatal", { error: "need at least 2 branch directives" }); return project; }

  const roundId = `r${Date.now()}`;

  // Persist a branch patch by MERGING only that branch's fields onto the latest
  // on-disk project — never a whole-object write from this minutes-long call,
  // which would clobber a concurrent keep/discard. Returns whether the round is
  // still active; false ⇒ it was kept/discarded and this branch must stop.
  const patch = async (b: Branch, p: Partial<Branch>): Promise<boolean> => {
    Object.assign(b, p);
    emit("branch", { branchId: b.id, patch: p });
    const fresh = await store.mutate(project.id, (fp) => {
      const fb = (fp.branches || []).find((x) => x.id === b.id);
      if (fb) Object.assign(fb, p);
    });
    return !!fresh && fresh.activeRoundId === roundId;
  };

  activeRounds.add(project.id);
  await reclaimPendingDbs(project.id).catch(() => {}); // retry old-DB deletes deferred by a prior keep
  try {
    const trunkSid = await ensureTrunkLive(project, fw);
    const baseline = appSrcFiles(project, fw);
    const dbAttached = !!(project.database && project.database.status === "running");

    const branches: Branch[] = dirs.map((directive, i) => ({
      id: `b${Date.now()}_${i}`, roundId, label: String.fromCharCode(65 + i), directive,
      parentSandboxId: trunkSid, sandboxId: null, status: "spawning" as BranchStatus,
      previewUrl: null, files: [],
      ambiguityId: resolve?.ambiguityId, readingLabel: resolve?.labels[i],
      createdAt: Date.now(),
    }));
    const round: BranchRound = {
      id: roundId, basePrompt, fromSandboxId: trunkSid,
      // Only record the trunk DB as a teardown target if a branch will actually
      // clone + replace it (dbAttached). Otherwise keep must never delete it.
      fromDatabaseId: dbAttached ? (project.database?.id ?? null) : null,
      baselineFiles: baseline, baseCheckpointId: project.checkpoints[project.checkpoints.length - 1]?.id,
      branchIds: branches.map((b) => b.id),
      ambiguityId: resolve?.ambiguityId, trunkReadingLabel: resolve?.trunkLabel,
      createdAt: Date.now(),
    };
    await store.mutate(project.id, (fp) => {
      fp.branches = [...(fp.branches || []), ...branches];
      fp.rounds = [...(fp.rounds || []), round];
      fp.activeRoundId = roundId;
    });
    project.branches = [...(project.branches || []), ...branches];
    project.rounds = [...(project.rounds || []), round];
    project.activeRoundId = roundId;
    emit("round", { round, branches });

    // Fan out — one bad branch never blocks the others.
    await Promise.allSettled(branches.map((b) => runOneBranch(project, fw, roundId, baseline, dbAttached, b, provider, patch)));

    // If the round was resolved (kept/discarded) while branches ran, do NOT write
    // a stale project — that would resurrect the round. Emit the fresh state.
    const fresh = (await store.get(project.id)) || project;
    emit("done", fresh);
    return fresh;
  } catch (e: unknown) {
    emit("fatal", { error: e instanceof Error ? e.message : String(e) });
    return project;
  } finally {
    activeRounds.delete(project.id);
  }
}

async function runOneBranch(
  project: Project, fw: FrameworkSpec, roundId: string, baseline: FileEntry[], dbAttached: boolean,
  b: Branch, provider: ReturnType<typeof pickProvider>, patch: (b: Branch, p: Partial<Branch>) => Promise<boolean>,
) {
  let childId: string | null = null;
  // Reclaim anything this branch created if the round is resolved out from under
  // it (so a fork/clone that raced past keep/discard can never leak).
  const abortCleanup = async () => {
    if (childId) await pandastack.deleteSandbox(childId).catch(() => {});
    if (b.databaseId) await pandastack.deleteDatabase(b.databaseId).catch(() => {});
  };
  try {
    // 1. CoW-fork the trunk (~0.7s; disk + node_modules ride the clone → no install).
    const fork = await pandastack.forkSandbox(b.parentSandboxId);
    childId = fork.childId;
    if (!(await patch(b, { sandboxId: childId, snapshotId: fork.snapshotId }))) return abortCleanup();
    await waitForGuest(childId);

    // 2. Full-stack only: clone the DB so this branch writes to its own data.
    //    Fail CLOSED — never reuse the trunk DB (guards against cross-branch writes).
    if (dbAttached && project.database) {
      await patch(b, { status: "cloning-db" });
      // Concurrent clones of the SAME source race the archive check — one branch
      // can get a spurious 412 "no restorable archive" while a sibling succeeds.
      // Retry with backoff so every branch gets its clone.
      let dbId: string | undefined;
      let lastErr = "database clone failed";
      for (let a = 0; a < 4; a++) {
        try { ({ id: dbId } = await pandastack.cloneDatabase(project.database.id, `riff-${project.id}-${b.label}-${a}`)); break; }
        catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
        await new Promise((r) => setTimeout(r, 8000));
      }
      if (!dbId) { await patch(b, { status: "error", error: lastErr }); return; }
      // Record the clone id IMMEDIATELY so teardown can reclaim it even if it
      // never becomes ready (the 2-min-archive fail path this feature lives with).
      if (!(await patch(b, { databaseId: dbId }))) { await pandastack.deleteDatabase(dbId).catch(() => {}); return abortCleanup(); }
      const deadline = Date.now() + 180000;
      let url: string | undefined;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const info = await pandastack.getDatabase(dbId).catch(() => null);
        if (info?.status === "running" && info.connection_url) { url = info.connection_url; break; }
        if (info?.status === "error") break;
      }
      if (!url) {
        await pandastack.deleteDatabase(dbId).catch(() => {}); // the half-provisioned clone is useless
        await patch(b, { status: "error", databaseId: null, error: "database clone did not become ready" });
        return;
      }
      await patch(b, { databaseUrl: url });
      if (fw.id === "next") await ensurePg(childId, noopPush);
    }

    // 3. Divergent codegen onto the cloned disk.
    if (!(await patch(b, { status: "generating" }))) return abortCleanup();
    let gen = await provider.generate({ prompt: b.directive, framework: fw, existingAppFiles: baseline, dbAttached, redesign: true });
    // Anti-echo: gpt-4o sometimes returns the entry file byte-for-byte unchanged.
    // A fork variant that looks identical is a non-result, so force a redo — and
    // this time WITHHOLD the existing files so there is nothing to copy. The model
    // must build the same app fresh in the requested direction.
    const entryOf = (fs: FileEntry[]) => fs.find((f) => f.path === fw.entryFile)?.content ?? "";
    if (entryOf(gen.files) === entryOf(baseline)) {
      gen = await provider.generate({
        prompt: `Build this app from scratch: ${b.directive}\n\nCommit fully to the described visual direction — this must NOT look like a generic default.`,
        framework: fw, existingAppFiles: [], dbAttached, redesign: true,
      });
    }
    await writeFiles(childId, gen.files);
    await patch(b, { files: gen.files, summary: gen.summary });
    await materializeImages(childId, fw, { ...project, files: mergeFiles(baseline, gen.files) }, noopPush);

    // 4. Start + verify, with the same per-branch self-fix loop as a normal build.
    let attempt = 0;
    while (true) {
      await patch(b, { status: "starting" });
      await restartDevServer(childId, fw, b.databaseUrl ?? undefined);
      await patch(b, { status: "checking" });
      const res = await pandastack.waitForServing(childId, fw.port, 90000);
      if (res.ok) { await patch(b, { previewUrl: pandastack.previewUrl(childId, fw.port), status: "live" }); return; }
      const log = await tailLog(childId);
      if (attempt >= MAX_FIX) { await patch(b, { status: "error", error: log.slice(-400) || "did not serve" }); return; }
      attempt++;
      await patch(b, { status: "generating" });
      gen = await provider.generate({ prompt: b.directive, framework: fw, existingAppFiles: baseline, feedback: log, dbAttached, redesign: true });
      await writeFiles(childId, gen.files);
      await patch(b, { files: gen.files, summary: gen.summary });
    }
  } catch (e: unknown) {
    await patch(b, { status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

// Promote the winner's already-live fork child to be the new trunk (no rebuild),
// then tear down the losers AND the pre-branch trunk to reclaim memory.
export async function keepBranch(project: Project, branchId: string): Promise<Project> {
  const fw = frameworkFor(project.framework);
  const round = (project.rounds || []).find((r) => r.id === project.activeRoundId);
  const win = (project.branches || []).find((b) => b.id === branchId);
  if (!round || !win) { project.error = "branch not found"; return project; }
  if (win.status !== "live" || !win.sandboxId) { project.error = "branch is not live"; return project; }

  const winSid = win.sandboxId, winDbId = win.databaseId, oldTrunkSid = round.fromSandboxId, oldDbId = round.fromDatabaseId;

  // Persist the promotion FIRST (read-modify-write) so state is correct even if
  // teardown stalls, and so a concurrent still-running round can't clobber it.
  const updated = (await store.mutate(project.id, (fp) => {
    fp.sandboxId = winSid;
    fp.previewUrl = win.previewUrl;
    fp.status = "live";
    fp.files = mergeFiles(mergeFiles(fw.scaffold(), round.baselineFiles), win.files);
    if (winDbId) fp.database = { id: winDbId, status: "running", connectionUrl: win.databaseUrl || undefined, createdAt: Date.now() };
    captureCheckpoint(fp, fw, round.basePrompt, win.summary || `Kept variation ${win.label}`);
    // Picking a variation IS the answer to the question that spawned it.
    recordDecision(fp, win.ambiguityId, win.readingLabel, win.directive);
    const fr = (fp.rounds || []).find((r) => r.id === round.id);
    if (fr) fr.keptBranchId = branchId;
    for (const fb of (fp.branches || []).filter((b) => b.roundId === round.id)) fb.status = fb.id === branchId ? "kept" : "discarded";
    fp.activeRoundId = null;
    fp.messages.push({ id: `m${Date.now()}`, role: "assistant", text: `Kept variation ${win.label}. It's now the main line.`, ts: Date.now() });
  })) || project;

  // Teardown AFTER persist, bounded by req()'s timeout. NEVER the winner; loser
  // clones delete fine (they have no dependents).
  const kills: Promise<unknown>[] = [];
  for (const b of (project.branches || []).filter((b) => b.roundId === round.id && b.id !== branchId)) {
    if (b.sandboxId && b.sandboxId !== winSid) kills.push(pandastack.deleteSandbox(b.sandboxId));
    if (b.databaseId && b.databaseId !== winDbId) kills.push(pandastack.deleteDatabase(b.databaseId));
  }
  if (oldTrunkSid && oldTrunkSid !== winSid) kills.push(pandastack.deleteSandbox(oldTrunkSid));
  await Promise.allSettled(kills);

  // The old SOURCE DB can only be deleted once the winner's clone is independent
  // of it — the platform 409s until then. Try now; if refused, queue it so a later
  // op (next round/keep, or project delete) reclaims it once the clone is ready.
  if (winDbId && oldDbId && oldDbId !== winDbId) {
    if (!(await pandastack.deleteDatabase(oldDbId))) {
      await store.mutate(project.id, (fp) => { fp.pendingDbDeletes = [...new Set([...(fp.pendingDbDeletes || []), oldDbId])]; });
    }
  }
  await reclaimPendingDbs(project.id).catch(() => {});
  return updated;
}

// Write a resolved fork onto the Brief so it is never asked, or offered, again.
function recordDecision(p: Project, ambiguityId?: string, readingLabel?: string, directive?: string) {
  if (!p.brief || !ambiguityId || !readingLabel) return;
  if (p.brief.decisions.some((d) => d.ambiguityId === ambiguityId)) return;
  p.brief.decisions.push({ ambiguityId, readingLabel, directive, source: "kept-branch" });
  p.brief.updatedAt = Date.now();
}

// "The one I already had is right." The trunk was never mutated by the round, so
// this is a discard plus a recorded decision — no rebuild, no promotion.
export async function keepTrunk(project: Project, roundId?: string): Promise<Project> {
  const rid = roundId || project.activeRoundId || undefined;
  const round = (project.rounds || []).find((r) => r.id === rid);
  const updated = await discardRound(project, rid);
  if (!round?.ambiguityId || !round.trunkReadingLabel) return updated;
  return (await store.mutate(project.id, (fp) => {
    recordDecision(fp, round.ambiguityId, round.trunkReadingLabel);
    fp.messages.push({ id: `m${Date.now()}`, role: "assistant", text: `Kept the original — ${round.trunkReadingLabel}. That's the main line.`, ts: Date.now() });
  })) || updated;
}

// Throw away a round: tear down its branches, leave the (never-mutated) trunk.
export async function discardRound(project: Project, roundId?: string): Promise<Project> {
  const rid = roundId || project.activeRoundId;
  const round = (project.rounds || []).find((r) => r.id === rid);
  // Nothing to discard for an unknown round, or one already resolved by a keep —
  // never tear down a kept winner's promoted resources.
  if (!round || round.keptBranchId) return project;

  const winnerSid = project.sandboxId; // the project's live trunk — never delete it
  const kills: Promise<unknown>[] = [];
  for (const b of (project.branches || []).filter((x) => x.roundId === round.id && x.status !== "kept" && x.sandboxId !== winnerSid)) {
    if (b.sandboxId) kills.push(pandastack.deleteSandbox(b.sandboxId));
    if (b.databaseId && b.databaseId !== project.database?.id) kills.push(pandastack.deleteDatabase(b.databaseId));
  }
  // Persist FIRST; clear activeRoundId ONLY if this is the active round.
  const updated = (await store.mutate(project.id, (fp) => {
    for (const fb of (fp.branches || []).filter((b) => b.roundId === round.id && b.status !== "kept")) fb.status = "discarded";
    if (fp.activeRoundId === round.id) fp.activeRoundId = null;
  })) || project;
  await Promise.allSettled(kills);
  return updated;
}

// --- intent helpers ---

// Record the reading the user picked. Matched against the STORED brief (whose ids
// the client was given), and the directive is copied inline so the decision keeps
// working after the Brief is regenerated on a later turn.
function applyDecisions(brief: Brief, decisions?: BriefDecision[]) {
  if (!decisions?.length) return;
  for (const d of decisions) {
    if (!d.ambiguityId || !d.readingLabel) continue;
    if (brief.decisions.some((x) => x.ambiguityId === d.ambiguityId)) continue;
    const am = brief.ambiguities.find((a) => a.id === d.ambiguityId);
    const directive = d.directive || am?.readings.find((r) => r.label === d.readingLabel)?.directive;
    brief.decisions.push({ ambiguityId: d.ambiguityId, readingLabel: d.readingLabel, directive, source: "user" });
  }
}

// Look at the app that is actually running and check it against the Brief. Returns
// null when there is nothing to check or no way to check it — the build then ends
// exactly as it did before this existed.
async function verifyTurn(project: Project, push: (s: AgentStep) => Promise<void>, fire: (e: string, d: unknown) => void): Promise<VerifyResult | null> {
  const acceptance = project.brief?.acceptance || [];
  if (!verifyEnabled() || !acceptance.length || !project.previewUrl) return null;
  await push(step("verify", "Checking it against the brief…", `${acceptance.length} acceptance checks`));
  const vr = await verifyApp(project.previewUrl, acceptance);
  if (vr.skipped) { await push(step("verify", "Acceptance check skipped", vr.skipped)); return null; }

  project.brief!.verdicts = vr.verdicts;
  project.brief!.updatedAt = Date.now();
  fire("verify", { verdicts: vr.verdicts });
  const pass = vr.verdicts.filter((v) => v.status === "pass").length;
  const fails = vr.verdicts.filter((v) => v.status === "fail");
  await push(
    fails.length
      ? step("verify", `${fails.length} of ${vr.verdicts.length} checks failed`, vr.evidenceNote || fails.map((f) => f.reason).join(" · ").slice(0, 200))
      : step("verify", `Matches the brief — ${pass}/${vr.verdicts.length} checks pass`),
  );
  await save(project);
  return vr;
}

// --- lifecycle helpers ---

async function ensureSandbox(project: Project, fw: FrameworkSpec, push: (s: AgentStep) => Promise<void>): Promise<{ sid: string; fresh: boolean }> {
  if (project.sandboxId && await pandastack.isAlive(project.sandboxId)) {
    return { sid: project.sandboxId, fresh: false };
  }
  if (project.sandboxId) await push(step("plan", "Previous microVM is gone — booting a fresh one…"));
  else { project.status = "booting"; await push(step("plan", "Booting a fresh microVM…")); }
  const sb = await pandastack.createSandbox("base");
  project.sandboxId = sb.id;
  await waitForGuest(sb.id);
  await push(step("plan", "microVM ready", `${sb.id.slice(0, 8)} · boot ${sb.boot_ms ?? "?"}ms`));
  return { sid: sb.id, fresh: true };
}

// A sandbox answers the control API before its guest agent is reachable, so the
// FIRST exec or file write can fail outright ("connect failed") or return empty
// without running. Probe until the guest actually answers. Applies to both a
// freshly created VM and a cold-booted fork — same vsock/ssh bridge, same race.
async function waitForGuest(sid: string, tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await pandastack.exec(sid, "echo rdy", 20000).catch(() => null);
    if (r && r.stdout.includes("rdy")) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

async function installDeps(sid: string, fw: FrameworkSpec, project: Project, push: (s: AgentStep) => Promise<void>) {
  project.status = "installing"; await push(step("install", "Installing dependencies…", fw.label));
  const r = await pandastack.exec(sid, `cd ${APP_DIR} && npm install --no-audit --no-fund 2>&1 | tail -3`, 300000);
  await push(step("install", "Dependencies installed", (r.stdout || r.stderr).trim().slice(-200)));
}

// Generate the images the code references via /riff-gen/<slug>.png and drop them
// into the sandbox's public dir. Skips any that already exist (dedup across turns)
// and is capped so a build can't fan out into unbounded image generation.
async function materializeImages(sid: string, fw: FrameworkSpec, project: Project, push: (s: AgentStep) => Promise<void>) {
  if (!imageGenEnabled()) return;
  const contents = project.files.filter((f) => fw.allowPath(f.path)).map((f) => f.content);
  const refs = findGenRefs(contents);
  if (!refs.length) return;
  const dir = `${APP_DIR}/${fw.publicDir}/riff-gen`;
  // Which are missing on disk already?
  const check = await pandastack.exec(sid,
    `mkdir -p ${dir}; for f in ${refs.map((r) => shq(r)).join(" ")}; do [ -f ${shq(dir)}/"$f" ] && echo "have $f" || echo "need $f"; done`, 20000).catch(() => null);
  const have = new Set((check?.stdout || "").split("\n").filter((l) => l.startsWith("have ")).map((l) => l.slice(5).trim()));
  const todo = refs.filter((r) => !have.has(r)).slice(0, MAX_GEN_IMAGES);
  if (!todo.length) return;
  await push(step("write", `Generating ${todo.length} image${todo.length > 1 ? "s" : ""}…`, todo.map(promptFromSlug).join(", ")));
  await Promise.all(todo.map(async (ref) => {
    try {
      const bytes = await generateImage(promptFromSlug(ref));
      await pandastack.writeFileBytes(sid, `${dir}/${ref}`, bytes);
    } catch { /* leave the ref unfilled rather than fail the build */ }
  }));
}

// Install the pg client on demand (a DB can be attached after the first build).
async function ensurePg(sid: string, push: (s: AgentStep) => Promise<void>) {
  const chk = await pandastack.exec(sid, `test -d ${APP_DIR}/node_modules/pg && echo yes || echo no`, 20000).catch(() => null);
  if (chk && chk.stdout.trim() === "yes") return;
  await push(step("db", "Wiring up Postgres client (pg)…"));
  await pandastack.exec(sid, `cd ${APP_DIR} && export PATH=/opt/mise/shims:$PATH && npm install pg --no-audit --no-fund 2>&1 | tail -2`, 180000).catch(() => {});
}

// Kills whatever is LISTENing on a TCP port, by walking /proc (no lsof/fuser
// needed). Next.js dev forks a worker that escapes the process group, so a
// group-kill alone leaves a zombie holding the port → EADDRINUSE on restart.
// Freeing the port itself is framework-agnostic and reliable.
const FREEPORT_PY = `import glob, os, re, signal, sys
port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
hexport = "%04X" % port
inodes = set()
for f in ("/proc/net/tcp", "/proc/net/tcp6"):
    try:
        for line in open(f).read().splitlines()[1:]:
            p = line.split()
            if len(p) > 9 and p[1].split(":")[-1].upper() == hexport and p[3].upper() == "0A":
                inodes.add(p[9])
    except Exception:
        pass
for fd in glob.glob("/proc/[0-9]*/fd/*"):
    try:
        tgt = os.readlink(fd)
    except Exception:
        continue
    m = re.match(r"socket:\\[(\\d+)\\]", tgt)
    if m and m.group(1) in inodes:
        try:
            os.kill(int(fd.split("/")[2]), signal.SIGKILL)
        except Exception:
            pass
`;

async function restartDevServer(sid: string, fw: FrameworkSpec, dbUrl?: string) {
  // Start the framework's dev server fully detached so it survives the exec
  // returning. Load-bearing: setsid (new session) + `</dev/null` (stdin off the
  // exec channel) + stdout/stderr to a log file. Before starting, we (a) kill the
  // previous run by its process-group id and (b) free the port outright — NEVER
  // `pkill -f`, which would match this command's own shell (its argv contains the
  // server name) and SIGKILL the exec before the server starts. Fire-and-forget:
  // waitForServing is authoritative.
  const LOG = "/var/log/riff-app.log";
  const PGID = "/tmp/riff-app.pgid";
  await pandastack.writeFile(sid, "/tmp/riff-freeport.py", FREEPORT_PY).catch(() => {});
  const dbExport = dbUrl ? `export DATABASE_URL=${shq(dbUrl)}; ` : "";
  const cmd =
    `if [ -f ${PGID} ]; then kill -TERM -- -"$(cat ${PGID})" 2>/dev/null; fi; ` +
    `python3 /tmp/riff-freeport.py ${fw.port} 2>/dev/null; sleep 0.5; ` +
    `export PATH=/opt/mise/shims:$PATH; ${dbExport}cd ${APP_DIR} && ` +
    `setsid sh -c ${shq("exec " + fw.devCommand)} </dev/null >${LOG} 2>&1 & ` +
    `echo $! > ${PGID}; sleep 1; echo started`;
  // Fire-and-forget: the server detaches server-side in ~2s; if the exec RESPONSE
  // hangs (common on a freshly cold-booted fork), bail fast and let waitForServing
  // (which polls the real preview host, 90s budget) be the source of truth.
  try { await pandastack.exec(sid, cmd, 8000); } catch { /* waitForServing decides truth */ }
}

// Delete current source files the incoming snapshot doesn't include (so a restore
// to an earlier version doesn't leave newer files behind).
async function clearSource(sid: string, fw: FrameworkSpec, keep: FileEntry[]) {
  const keepSet = new Set(keep.map((f) => f.path));
  const roots = fw.id === "next" ? "app components lib" : fw.id === "static" ? "." : "src";
  const r = await pandastack.exec(sid,
    `cd ${APP_DIR} && find ${roots} -type f 2>/dev/null | sed 's|^\\./||'`, 20000).catch(() => null);
  if (!r) return;
  const present = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const stale = present.filter((p) => fw.allowPath(p) && !keepSet.has(p));
  if (stale.length) await pandastack.exec(sid, `cd ${APP_DIR} && rm -f ${stale.map((s) => shq(s)).join(" ")}`, 20000).catch(() => {});
}

function captureCheckpoint(project: Project, fw: FrameworkSpec, prompt: string, message: string) {
  const cp: Checkpoint = {
    id: `c${Date.now()}_${project.checkpoints.length}`,
    label: `v${project.checkpoints.length + 1}`,
    message, prompt,
    files: appSrcFiles(project, fw),
    createdAt: Date.now(),
  };
  project.checkpoints.push(cp);
  if (project.checkpoints.length > 40) project.checkpoints = project.checkpoints.slice(-40);
}

// --- small helpers ---
async function save(p: Project) { await store.put(p); }
function shq(s: string): string { return `'` + s.replace(/'/g, `'\\''`) + `'`; }
function appSrcFiles(p: Project, fw: FrameworkSpec): FileEntry[] {
  return p.files.filter((f) => fw.allowPath(f.path));
}
function mergeFiles(cur: FileEntry[], next: FileEntry[]): FileEntry[] {
  const m = new Map(cur.map((f) => [f.path, f]));
  for (const f of next) m.set(f.path, f);
  return [...m.values()];
}
// Each file write opens its own channel to the guest, and sshd caps concurrent
// sessions per connection (OpenSSH defaults to 10). An unbounded Promise.all over
// a scaffold plus a handful of generated components blows straight through that
// and the platform answers "ssh: rejected: connect failed" — so writes run a few
// at a time. Still concurrent, just inside the guest's budget.
const WRITE_CONCURRENCY = 4;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

async function writeFiles(sid: string, files: FileEntry[]) {
  await mapLimit(files, WRITE_CONCURRENCY, (f) => pandastack.writeFile(sid, `${APP_DIR}/${f.path}`, f.content));
}
async function tailLog(sid: string): Promise<string> {
  try { const r = await pandastack.exec(sid, "tail -40 /var/log/riff-app.log 2>/dev/null", 20000); return r.stdout || ""; }
  catch { return ""; }
}
