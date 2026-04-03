# Project Overview
- Bun-based TypeScript project with Docker support; keep human-facing docs in `README.md` and use this file for agent directives.
- Work remains agent-agnostic—assume no private credentials are available and prefer reproducible, scripted changes.

## Environment & Tooling
- Use the Bun version pinned via `bun.lock` and Docker (`oven/bun:1-slim`). Verify with `bun --version` when troubleshooting and document any version bumps here.
- Install dependencies with `bun install`; never edit `bun.lock` by hand and commit it with dependency changes.
- Rely on `package.json` scripts via `bun run <script>` for consistent tooling. Extend scripts instead of invoking binaries directly.
- Leverage Docker for parity: `docker compose up --build` should produce a working environment after updates. Keep container scripts reproducible and avoid mutating state outside version control.

## Core Commands
- Install: `bun install`
- Application: `bun start`
- Watch mode: `bun dev`
- Check: `bun run check`
- Autofix check issues: `bun run check:fix`
- Type-check: `bun typecheck`
- Tests: `bun test` (supports `--watch`, `--concurrent`, `--max-concurrency`, and `--coverage` for CI scenarios)
- Add more task-specific commands here as they emerge (keep this list authoritative for agents).

## Development Workflow
1. Inspect the nearest `AGENTS.md` plus task instructions before editing; clarify unknowns before changing files.
2. When asked to plan or brainstorm, outline the approach in conversation first; begin coding only after the plan is acknowledged.
3. Favor small, reviewable diffs scoped to the feature or fix. Add or update tests alongside behavioral changes.
4. Run `bun run check`, `bun typecheck`, and `bun test` before completion. Capture command output for review summaries when relevant.
5. For remote dependency updates, note the rationale and relevant changelog entries in commit/PR descriptions.
6. Prefer scripted workflows (npm-style scripts, `docker compose`, or Make targets) over ad-hoc commands to preserve reproducibility.

## Architecture & Conventions
- Organize source under `src/` and keep modules ES-module compatible. Reuse shared utilities thoughtfully.
- Align with the existing Biome config (`biome.json`) and TypeScript settings (`tsconfig.json`). Avoid disabling rules without justification.
- Prefer explicit interfaces or type aliases over `any`; leverage Bun/TypeScript types from `@types/bun` where applicable.
- Keep environment variables documented in `.env.example` or deployment manifests, not here. Never commit real secrets.

## Testing Guidance
- Use Bun's test runner (`bun test`) with describe/it semantics. Factor helpers under `src/` or a dedicated `tests/` folder as the codebase grows.
- Isolate side effects; mock network or filesystem interactions when deterministic tests are required.
- For CI, consider `bun test --coverage` or JUnit reporters if pipelines require artifacts. Seed randomized tests to reproduce failures (`--seed`).

## Data & External Services
- PostgreSQL: provision with Docker image `postgres:17`; prefer `npm:kysely` + `npm:pg` for data access. Version-control migrations.
- Redis: use Docker image `redis:8`; interact via `npm:bullmq` and `npm:ioredis`.
- Telegram bots: use `npm:grammy` per project policy. Create the bot instance once in `src/index.ts`, register middleware via a separate composer file, and avoid grammy sessions.
- Record credentials securely (never commit secrets); provide mock values for tests.

## Docker & Deployment Notes
- Keep Docker builds reproducible; install the required Bun version explicitly and minimize layers.
- Synchronize exposed ports and health checks across `Dockerfile`, `docker-compose.yml`, and any deployment manifests.
- Run containerized smoke tests (`bun test` or project-specific checks) before publishing new images.

## Git & Review Practices
- Branch from `main` using descriptive names (e.g., `feature/<slug>` or `fix/<slug>`).
- Keep commits atomic with conventional prefixes (`feat:`, `fix:`, `chore:`, etc.).
- Include evidence (test output, screenshots, logs) when opening PRs; do not ship with failing quality checks.
- Scan diffs for secrets before committing or pushing.

## Agent Playbook
- Treat this file as the single source of truth for agents; link to README or design docs instead of duplicating content.
- Update this document whenever build/test commands or conventions change; keep it under ~150 lines for fast ingestion.
- When instructions conflict, favor explicit task prompts or nearer `AGENTS.md` files in the directory tree.

## Maintenance Checklist
- After significant changes, rerun check/typecheck/tests and refresh Docker artifacts if relevant.
- Archive or replace stale guidance quickly—outdated directions slow future automations.
- Encourage contributors to reference this file in PR templates to keep agent context current.
