# Riff Understands — plan

*Status: **milestone 1 shipped** · Sept 2026*

> **Built and live-verified (8 Sep 2026):** Phase 1 (the Brief, assumption chips, the
> one-question gate, brief-driven codegen), a minimal Phase 2 (fork-to-resolve from the
> Brief's readings, decisions recorded on keep), and Phase 3 screenshot-only
> (`lib/verify.ts` — capture the running app, judge it against the acceptance list, one
> semantic fix). Phases 4 and 5 are still proposals.
>
> Two findings from the build worth carrying forward: `gpt-4o-mini` will not surface a
> genuine ambiguity, so the Brief defaults to `gpt-4o`; and the very first verification
> run caught a real defect the old HTTP check called "Live" — a *"chart coming soon"*
> placeholder shipped in place of a chart.

## The one-paragraph version

Today Riff is prompt → files → live VM. It never tells you what it thinks you meant, never asks when it can't tell, never checks the running app against what you asked for, and forgets your intent between turns. The proposal is an **intent layer** with four visible behaviours, in this order of leverage:

1. **The Brief.** Before it builds, Riff shows what it understood in ~2 seconds: audience, the jobs the app must do, screens, data, and the assumptions it is making. Assumptions are chips you can flip. Building starts immediately unless one assumption is both uncertain and high-impact.
2. **Show me, don't ask me.** When a prompt genuinely has two or three readings, Riff doesn't put up a questionnaire. It builds the most likely reading, then forks the running app (and its Postgres) into the other readings and shows them live, side by side. Only Riff can do this, because only Riff has sub-second copy-on-write forks of a real VM plus a cloned database. This is the "wow".
3. **Did it do what you meant?** After the app is live, Riff captures a screenshot and the DOM, checks every acceptance item in the Brief, and feeds semantic misses ("there is no pause button") back into the existing self-fix loop. Today the loop only fixes "did not serve".
4. **It remembers.** The Brief is a living spec that every follow-up is interpreted against, and every branch you keep or discard teaches Riff your taste.

Recommended first milestone (about two weeks): the Brief, a one-click "show me the other reading" fork, and screenshot-based verification. That is enough for the demo: *"a dashboard for my bakery"* → Brief says *"assuming owner-facing ops; could also be a customer-facing menu"* → app is live → one click → the customer-menu reading comes up in a second VM next to it → keep one.

---

## What the market does today (research, Sept 2026)

| Product | How it "understands" | Gap Riff can own |
|---|---|---|
| **Lovable** — Plan mode (ex-Chat mode) with follow-up questions | Asks text questions about audience, features, design, tech before building. Separate mode, costs a credit per message. | Questions are a form; nothing is shown. No verification against intent. |
| **Replit Agent 3** | Plans, builds, then *self-tests in a real browser* (clicks through, fixes failures) for up to 200 min. | Verifies that things *work*, not that they match what you *meant*. No visible spec, no alternatives. |
| **Kiro (AWS)** — spec-driven | Generates `requirements.md` (EARS acceptance criteria), `design.md`, `tasks.md`, with approval gates or a no-gate Quick Spec. | Heavyweight, developer-facing, document-first. Good pattern for *acceptance criteria as the verify checklist*. |
| **v0**, **bolt.new** | v0 became agentic (plans multi-step). bolt has Discussion mode (talk without codegen). | Text planning only. |
| **Aviator Verify** (dev tooling) | Intent → explicit acceptance criteria → verifies each against the running code with evidence (screenshots, requests). | Proves the pattern works for PRs; nobody applies it inside a consumer app builder. |

Research that shapes the design:

- **ClarifyGPT** (FSE 2024): detect ambiguity with a *code-consistency check* (sample several solutions; if they diverge, the requirement is ambiguous), then ask *targeted* questions only in that case. Lifted GPT-4 Pass@1 from 70.96% to 80.80% on MBPP-sanitized. Lesson: **gate questions on measured ambiguity, never ask by default.**
- **AssumptionMiner** (2026): make the implicit assumptions in generated code an explicit, editable artifact; F1 0.816 on extraction; regenerate only the code that depends on a changed assumption. Lesson: **assumptions are the UI**, and edits should be targeted.
- Lovable's own framing: "most AI mistakes happen because the AI doesn't fully understand what you want to build." Everyone agrees on the problem; the differentiator is *how* you resolve it.

**The gap in one line:** every competitor resolves ambiguity with text (questions or plans). Riff has the one primitive that lets it resolve ambiguity by *showing live alternatives*, and a real database per project that lets those alternatives differ in data model, not just colour.

---

## Principles

1. **Understanding is visible, fast, and never a gate by default.** The Brief streams from a fast model in 1–2 s and the build starts as soon as it lands. Total added latency to first live: under 2 s.
2. **Assume and state, don't interrogate.** Every assumption is shown as a chip with its alternative. At most *one* question per build, only when an assumption is high-impact *and* low-confidence, always with a default preselected and a "just build it" escape.
3. **When in doubt, show.** If readings differ structurally (screens, data model, primary flow) and the app is live, fork rather than ask. If they differ only cosmetically, assume.
4. **Verify against intent, not uptime.** "Live" today means HTTP < 500. It should mean "the acceptance items in the Brief are visibly true."
5. **Intent persists.** The Brief is the spec of record for the project; follow-ups edit the Brief first, then the code. Keep/discard decisions become durable preferences.

---

## Phase 1 — The Brief (foundation, ~1 week)

**What the user sees.** A card at the top of the chat column, streaming in before any build step:

> **Pomodoro timer** · for solo focus sessions · React
> Does: start/pause/reset a 25-min timer · shows remaining time in a circular ring · short/long breaks
> I'm assuming: `25/5/15 min defaults ⇄ configurable` · `no sound ⇄ chime at zero` · `single page ⇄ history view`
> Not sure: *is this personal or shared across a team?* — **Personal** · Team · Just build it

Chips flip on tap. Flipping after the build has started queues a follow-up turn with the changed assumption (no separate "regenerate" concept).

**Data model** (`lib/types.ts`):

```ts
interface Brief {
  title: string; oneLiner: string; audience: string;
  jobs: string[];                                   // what the user will do with it
  screens: { name: string; purpose: string }[];
  entities?: { name: string; fields: string[] }[];  // only when data is implied
  assumptions: { id: string; text: string; alternative: string; confidence: number; impact: "low"|"med"|"high" }[];
  ambiguities: { id: string; axis: string; readings: { label: string; directive: string }[]; impact: "low"|"med"|"high" }[];
  acceptance: { id: string; text: string; check: "visual"|"dom"|"interaction" }[];
  nonGoals: string[]; styleDirection: string;
  decisions: { ambiguityId: string; readingLabel: string; source: "user"|"kept-branch" }[];
  confidence: number; createdAt: number; updatedAt: number;
}
// Project gains: brief?: Brief
```

**Generation** (`lib/intent.ts`): `generateBrief({ prompt, framework, existingBrief?, imageDataUrl? })` on a fast model (Haiku 4.5 or gpt-4o-mini class; new `RIFF_FAST_MODEL` env, provider chosen by the same key precedence as codegen), structured output, streamed as an SSE `brief` event before the first `step`. Ambiguity detection starts as model self-report; add ClarifyGPT-style consistency sampling (two cheap drafts, diff `screens`/`entities`) once we have data on false positives.

**Codegen.** `CodegenRequest.brief` is rendered into `buildUserPrompt()` as a compact spec block ("Build to this brief. Acceptance: …"). This alone should raise first-build quality: the Brief acts as the plan the codegen model would otherwise have to improvise inside its JSON payload.

**Gate.** In `runAgentTurn`, after the Brief: if any `ambiguity.impact === "high"` and the project has no trunk yet → emit `brief` with `needsInput: true` and end the turn; the client re-posts with `decisions`. Otherwise proceed. Everything else stays as it is.

**Files touched.** `lib/types.ts`, new `lib/intent.ts`, `lib/codegen/index.ts` (prompt), `lib/agent.ts` (brief step + gate), `app/api/chat/route.ts` (accept `decisions`), new `components/BriefCard.tsx`, `components/Workspace.tsx` (handle `brief` event and `needsInput`).

**Cost/latency.** One extra call of ~1.5k input / ~600 output tokens on a fast model: ~1–2 s, well under a cent.

---

## Phase 2 — Show me, don't ask me (the wow, ~1–2 weeks)

**What the user sees.** Once the trunk is live, the Brief card shows the unresolved readings: *"I built the owner-facing dashboard. Show me the customer-menu reading?"* One click starts a fork round. The compare grid shows the trunk as tile **A** with its reading, and the forks as **B**/**C** with theirs — captions are the interpretations, not the raw directives. Keep one → the Brief records the decision, the loser VMs are torn down, and the choice feeds taste memory (Phase 5).

**Why it is unique.** `runBranchRound` already forks the VM in ~0.7 s and clones the database when one is attached. That means a reading that changes the *data model* ("bookings per user" vs "bookings per room") runs with its own schema and its own data. No browser-sandbox builder can do that; DB-backed ones (Lovable + Supabase) would have to migrate one shared database.

**Mechanics.**
- `Brief.ambiguities[].readings[].directive` is written by the Brief model in the form `runBranchRound` already consumes. Reading A's directive is folded into the trunk's codegen prompt; the round is called with B and C only.
- Extend `CompareGrid` to include the trunk as a tile (today it shows branches only; `Project.previewUrl` is already there).
- `keepBranch` appends `{ ambiguityId, readingLabel, source: "kept-branch" }` to `brief.decisions`. Keeping the trunk tile is a new no-op path that just records the decision and discards the round.
- **Auto-explore setting** (off by default): if the Brief's top ambiguity is high-impact and structurally different, start the round automatically as soon as the trunk is live. Respect the existing single-round guard (`activeRounds`, 409s).
- Caps: at most 3 readings; only fork on structural axes (`screens`, `entities`, primary flow); cosmetic axes become assumption chips instead.

**Files touched.** `lib/agent.ts` (post-live hook, decision recording), `components/riff-ui.tsx` (`CompareGrid` trunk tile, captions), `components/BriefCard.tsx`, `lib/types.ts` (`Branch.readingLabel`).

---

## Phase 3 — Did it do what you meant? (~1–2 weeks)

**What the user sees.** The Brief's acceptance list ticks live after the app comes up: ✓ *counts down from 25:00* · ✓ *circular ring* · ✗ *pause button* → "fixing…" → ✓. If something can't be verified it says so rather than pretending.

**Mechanics** (`lib/verify.ts`):
- **Evidence.** After `waitForServing` succeeds, capture the preview URL with `playwright-core` driving the system Chrome on the orchestrator (no browser download; the preview host is reachable from the orchestrator today — `waitForServing` already fetches it). Collect: full-page screenshot, accessibility tree / visible text, console errors. For `check: "interaction"` items, run the 1–3 scripted actions the Brief model wrote (click by accessible name, type, wait) and screenshot again.
- **Judge.** One vision call: acceptance items + evidence → per-item `pass | fail | unverifiable` with a one-line reason and a concrete fix instruction.
- **Fix.** Failures are joined into the existing `feedback` string and fed to `provider.generate(...)` exactly like a build-log failure; cap at one semantic retry per turn (new `MAX_SEMANTIC_FIX = 1`) so a flaky judge can't loop.
- Also closes a real hole: today an app that returns 200 with a blank page or a client-side exception is reported "Live". The console-error and blank-screenshot checks catch it.

**Cost/latency.** ~3–6 s for capture, one vision call (~1–3 cents). Kill switch `RIFF_VERIFY=0`; skipped for the template provider.

**Files touched.** new `lib/verify.ts`, `lib/agent.ts` (verify step after live, before checkpoint), `lib/types.ts` (`AgentStep.kind` gains `"verify"`), `components/ui.tsx` (`StepRow` for verify), `package.json` (`playwright-core`).

---

## Phase 4 — Follow-ups that understand context (~1 week)

Today a follow-up is appended verbatim to the codegen prompt with all current files. Add `interpretFollowUp({ brief, messages, prompt, files })` on the fast model, producing:

- a **classification**: `tweak` (no Brief change, go straight to codegen), `feature` (Brief delta + codegen), `pivot` (regenerate the Brief, then gate as in Phase 1);
- an **explicit rewrite** of the request with references resolved ("make it bigger" → "increase the timer digits in `src/App.tsx` from 48px to ~72px");
- **conflicts** with kept decisions or acceptance items, surfaced as a single chip: *"This removes the sidebar you kept in B — go ahead?"*

The rewrite replaces the raw prompt in `buildUserPrompt`; the delta is merged into `project.brief`. Adds ~1 s to follow-up turns; `tweak` skips the Brief update entirely so quick edits stay quick.

**Files touched.** `lib/intent.ts`, `app/api/chat/route.ts`, `lib/agent.ts`, `components/BriefCard.tsx`.

---

## Phase 5 — Understands your data and your taste (~2 weeks)

**Your data.** Drop a CSV/JSON/spreadsheet into the composer (the image drop zone already exists). The Brief model infers `entities` from headers and sample rows; with a database attached, Riff creates the tables and seeds the rows in the managed Postgres (`ensurePg` + a one-off `exec`) before codegen, and the app is built over real data from turn one. Treat file contents strictly as data in prompts (no instructions honoured from inside a CSV).

**Your taste.** A short per-user note (stored in the SQLite store, new `prefs` table) distilled by the fast model from signals Riff already has: which branch was kept and why (the losing readings), theme-panel picks, repeated corrective follow-ups. Injected into Brief and codegen prompts; shown and editable in the UI ("Your taste: dark, dense, tabular numerals"). Keep/discard is a preference signal no other builder collects.

---

## End-to-end flow after all phases

```
prompt ──▶ Brief (1–2 s, streamed) ──▶ high-impact ambiguity & no trunk? ──▶ one chip question (default preselected)
                                                    │ no
                                                    ▼
                                   build reading A (existing loop) ──▶ live ──▶ verify vs acceptance (≤6 s)
                                                                                     │ fail → semantic fix (×1)
                                                                                     ▼
                                              "show me the other reading?" ──▶ fork B, C (VM + DB) ──▶ compare ──▶ keep
                                                                                                                  │
                                                                             brief.decisions += ; taste += ◀──────┘
follow-up ──▶ interpret (tweak | feature | pivot) ──▶ conflicts? one chip ──▶ codegen with explicit rewrite
```

---

## Model routing and config

| Job | Model class | Env |
|---|---|---|
| Brief, follow-up interpretation, taste distillation | fast (Haiku 4.5 / gpt-4o-mini) | `RIFF_FAST_MODEL` |
| Codegen | existing (`OPENAI_MODEL` / `ANTHROPIC_MODEL`) | unchanged |
| Verification judge | vision-capable main model | `RIFF_VERIFY=0` to disable |

New SSE events: `brief` (full or streamed chunks), `verify` (per-item results). All existing events unchanged, so old clients keep working.

---

## What to measure

- **First-build acceptance**: share of projects with no corrective follow-up in the next two turns. Primary metric.
- **Corrective follow-ups per project** (should fall as the Brief improves).
- **Verify catch rate**: share of builds where the acceptance pass found a miss the HTTP check reported as live.
- **Time to first live**: must stay within +2 s of today.
- **Fork-on-ambiguity usage and keep rate** when offered.

---

## Risks and how the plan handles them

- **Latency creep** → fast model, streamed Brief, build starts on arrival, at most one blocking question.
- **Over-asking** → ClarifyGPT-style gate, hard cap of one question, default preselected, "just build it" always present.
- **Flaky verification** → one semantic retry, evidence shown to the user, `unverifiable` is an honest outcome, kill switch.
- **Cost of forks** → forks are copy-on-write and near-free on PandaStack; the cost is codegen per reading, capped at three.
- **Concurrency** → auto-forks go through the existing `activeRounds`/409 guards; nothing new bypasses `store.mutate`.
- **Prompt injection via uploaded data** → uploaded content is quoted as data, never as instructions.
- **Vite/static database path** → the `/__riff/db/query` endpoint those prompts reference is not served by this repo; Phase 5's data features should target the Next.js framework first.

---

## Suggested milestone 1 (two weeks)

1. Phase 1 complete (Brief, chips, gate, Brief in codegen prompt).
2. Phase 2 minimal: the "show me the other reading" button after first live, trunk tile in the grid, decision recording on keep. No auto-explore yet.
3. Phase 3 screenshot-only: capture + judge + one semantic retry, no scripted interactions.

Demo script: *"a dashboard for my bakery"* → Brief in 2 s with the owner/customer ambiguity → app live → click → second VM live beside it → keep → the Brief shows the decision.

---

## Sources

- Lovable — [Plan mode docs](https://docs.lovable.dev/features/plan-mode), [Chat mode & follow-up questions](https://lovable.dev/blog/chat-mode-and-questions)
- Replit Agent 3 — [guide](https://www.digitalapplied.com/blog/replit-agent-3-browser-full-stack-coding-guide), [review](https://www.openaitoolshub.org/en/blog/replit-agent-review)
- Kiro — [Specs](https://kiro.dev/docs/specs/), [Feature specs](https://kiro.dev/docs/specs/feature-specs/), [Specs explained](https://codemyspec.com/blog/kiro-specs-explained)
- v0 / bolt — [v0 vs Bolt review](https://www.index.dev/blog/v0-vs-bolt-ai-app-builder-review), [v0 guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026)
- ClarifyGPT — [arXiv 2310.10996](https://arxiv.org/abs/2310.10996), [FSE 2024](https://dl.acm.org/doi/10.1145/3660810)
- AssumptionMiner — [arXiv 2607.22898](https://arxiv.org/html/2607.22898)
- Aviator Verify — [aviator.co/verify](https://www.aviator.co/verify)
