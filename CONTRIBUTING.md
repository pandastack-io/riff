# Contributing to Riff

Thanks for your interest in Riff — the open-source, self-hostable app builder where
every generated app runs in a real Firecracker microVM. Contributions of all kinds
are welcome: bug reports, features, docs, and framework support.

## Ground rules

- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).
- Open an issue before a large change so we can align on direction.
- Keep PRs focused — one concern per PR is easiest to review.
- Never commit secrets. `.env.local` is git-ignored; keep it that way.

## Getting set up

```bash
git clone https://github.com/pandastack-io/riff.git
cd riff
npm install
cp .env.local.example .env.local   # add PANDASTACK_API_KEY + OPENAI_API_KEY
npm run dev                        # → http://localhost:4321
```

You'll need a [PandaStack](https://app.pandastack.ai) API key (the compute layer —
or point `PANDASTACK_API_URL` at your own self-hosted cluster) and an
`OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) for codegen. Without a model key, a
deterministic template generator still runs the whole pipeline end-to-end.

## Project layout

| Path | What's there |
|---|---|
| `app/` | Next.js routes: `/` (home), `/projects`, `/project/[id]`, and `app/api/**` route handlers |
| `components/` | UI — `riff-ui.tsx` (presentational) and `Workspace.tsx` (the stateful workspace) |
| `lib/agent.ts` | The agent loop: generate → run → observe → self-fix, plus fork-to-explore |
| `lib/frameworks.ts` | Framework registry (React / Next.js / static) — fixed harness + codegen contract |
| `lib/codegen/` | Model providers (OpenAI / Anthropic / template) |
| `lib/pandastack.ts` | Thin PandaStack SDK client |
| `lib/store.ts` | SQLite-backed project store |

## Before you push

```bash
npx tsc --noEmit    # types must pass
npm run build       # production build must succeed
```

CI runs both on every PR (see `.github/workflows/ci.yml`).

## Pull requests

1. Fork the repo and branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Make your change; keep the existing code style (match the surrounding file).
3. Verify `tsc` and `build` pass locally.
4. Open a PR against `main` with a clear description and, where it helps, a screenshot.

## Adding a framework

Framework support lives in `lib/frameworks.ts`. A framework declares its fixed
harness (`scaffold`), dev command, port, and its codegen contract (system prompt,
entry file, and which paths the model may write). Follow the existing `vite-react`
/ `next` / `static` entries — the fixed-harness pattern is what keeps generated
(untrusted) code from breaking the preview.

Questions? Open a [discussion or issue](https://github.com/pandastack-io/riff/issues).
