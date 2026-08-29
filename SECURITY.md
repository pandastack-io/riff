# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in Riff, please **do not open a public
issue**. Instead, report it privately via GitHub's
[private vulnerability reporting](https://github.com/pandastack-io/riff/security/advisories/new)
(Security → Report a vulnerability), or email the maintainers.

Please include:

- A description of the issue and its impact
- Steps to reproduce
- Any relevant logs or proof-of-concept (with secrets redacted)

We'll acknowledge your report as quickly as we can and keep you updated on the fix.

## Scope notes

- Riff **never executes generated code in the orchestrator** — all generated
  (untrusted) code runs inside a PandaStack Firecracker microVM (KVM isolation).
  That boundary is the core of Riff's security model; issues that weaken it are
  high priority.
- Secrets (`PANDASTACK_API_KEY`, `OPENAI_API_KEY`, etc.) live only in `.env.local`,
  which is git-ignored. Never commit real keys.
- Riff is intended to be run by its operator (self-hosted or local). Multi-tenant
  hardening (auth, per-user quotas) is on the roadmap, not yet in place — run it
  behind your own authentication if you expose it.
