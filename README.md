# @deerdaily/codex-pr-agent

`@deerdaily/codex-pr-agent` is a globally installable Bun + TypeScript CLI that runs a deterministic Git workflow around `git`, `gh`, and `codex`.

It is designed to be executed inside an existing Git repository with a single quoted prompt:

```bash
deer-agent "add a regression test for the PR review loop"
```

The Bun CLI stays in control of the workflow and uses Codex only for bounded subtasks such as branch naming, implementation, commit text, PR text, and review-fix passes.

## Prerequisites

The following tools must already be installed and available on `PATH`:

- Bun
- Git
- GitHub CLI (`gh`)
- Codex CLI (`codex`)

You also need:

- a Git repository with a configured `origin` remote
- `gh` authenticated against the target repository
- `codex` authenticated and able to run `codex exec`
- permission to push branches and open pull requests in the target repository

The implementation was wired against locally verified help output from:

- `codex exec --help`
- `gh pr create --help`
- `gh pr view --help`
- `gh pr edit --help`
- `gh api --help`

## Install

Global install with Bun:

```bash
bun install -g @deerdaily/codex-pr-agent
```

Local development install:

```bash
bun install
```

Run locally from this repository:

```bash
bun start -- "implement the requested change"
```

## Expected Auth And Setup

This CLI assumes the external CLIs are already configured:

- `gh auth status` should report an active authenticated session.
- `codex exec --help` should succeed and Codex should be able to execute non-interactively.
- `git push` to `origin` should work for the current repository.

The review re-request flow uses:

```bash
gh pr edit <number> --add-reviewer @copilot
```

That path is explicitly documented by the installed `gh` help output for environments that support Copilot review requests. If the current GitHub environment does not support `@copilot`, the CLI will fail with the underlying `gh` error.

## Workflow

Given a single prompt argument, the CLI runs this sequence:

1. Resolve the current repository root with `git rev-parse --show-toplevel`.
2. Read the current branch with `git rev-parse --abbrev-ref HEAD`.
3. Refuse to continue unless the branch is `main` or `master`.
4. Refuse to continue unless `git status --porcelain` is empty.
5. Ask Codex for a feature-branch name using `codex exec` in read-only mode.
6. Fall back to a deterministic slugged branch name if Codex fails or returns invalid output.
7. Create the branch from the current base branch with `git checkout -b <branch> <base>`.
8. Invoke `codex exec` non-interactively to implement the user request.
9. If no files changed, stop cleanly without committing or opening a PR.
10. If files changed, stage everything with `git add --all`.
11. Ask Codex for a one-line commit message and fall back to a deterministic conventional message if needed.
12. Commit and push the branch.
13. Ask Codex for a PR title/body and fall back to a deterministic template if needed.
14. Open the PR with `gh pr create --base ... --head ... --title ... --body ...`.
15. Resolve PR metadata with `gh pr view <branch> --json ...`.
16. Request Copilot review with `gh pr edit <number> --add-reviewer @copilot`.
17. Enter the review loop.

## Review Loop

After the PR is created, the CLI enters a deterministic polling loop:

1. Wait 10 minutes.
2. Fetch review comments with:

```bash
gh api --paginate --slurp repos/{owner}/{repo}/pulls/<number>/comments
```

3. Ignore reply comments and ignore comment IDs that were already processed earlier in the same run.
4. If there are no new actionable top-level review comments, exit cleanly.
5. Send only the new actionable comment set to `codex exec` for validation and fixes.
6. If Codex produces no file changes, exit cleanly.
7. If Codex does produce changes, stage, commit, and push them.
8. Only after a successful push, request Copilot review again with `gh pr edit <number> --add-reviewer @copilot`.
9. Repeat the loop.

This prevents the tool from reprocessing the same review comments forever.

## Deterministic Fallbacks

The CLI includes code-driven fallbacks for the helper text generation steps:

- branch name fallback: deterministic `feature/<slug>-<hash>`
- commit message fallback: deterministic conventional-commit style summary
- PR title/body fallback: deterministic title plus a short markdown template

If Codex helper calls fail for those bounded text tasks, the workflow still proceeds.

## Major Failure Conditions

The CLI exits non-zero when:

- the current branch is not `main` or `master`
- the workspace is dirty before the run starts
- `git`, `gh`, or `codex` commands fail
- branch creation fails
- push fails
- PR creation fails
- Copilot review request fails in the current GitHub environment

The CLI also stops without creating a PR when Codex completes the implementation pass but leaves no file changes.

## Development

Install dependencies:

```bash
bun install
```

Run checks:

```bash
bun run check
bun typecheck
bun test
```

## Docker

The repository also includes a simple containerized CLI environment. Build and print the CLI help:

```bash
docker compose up --build
```

Run the CLI with an explicit prompt:

```bash
docker compose run --rm app "update the README examples"
```
