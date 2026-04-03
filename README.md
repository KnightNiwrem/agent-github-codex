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

## CLI Options

The CLI currently accepts the required prompt argument plus an optional review-loop control flag:

```bash
deer-agent --max-unproductive-polls 3 "implement the requested change"
```

`--max-unproductive-polls` controls how many consecutive review polls with no new actionable comments are allowed before the process exits.

- default: `1`
- `0`: poll indefinitely
- any positive integer: exit after that many consecutive no-op polls

An "unproductive poll" means the review loop fetched PR review comments and found no new actionable top-level comments that had not already been handled in the current run.

## Expected Auth And Setup

This CLI assumes the external CLIs are already configured:

- `gh auth status` should report an active authenticated session.
- `codex exec --help` should succeed and Codex should be able to execute non-interactively.
- `git push` to `origin` should work for the current repository.

The review re-request flow uses:

```bash
gh pr edit <number> --add-reviewer <reviewer1,reviewer2>
```

Reviewers come from the repository-local harness config in `.agc/config.json`. The default value is `["@copilot"]`, and when multiple reviewers are configured the CLI passes them to `gh` as a single comma-separated `--add-reviewer` argument. If a configured reviewer is not supported in the current GitHub environment, the CLI will fail with the underlying `gh` error.

## Repository-Local Harness State

This CLI standardizes its own repository-local config and runtime state under `.agc/` at the repository root.

The harness creates and manages this layout:

```text
.agc/
  config.json
  state/
```

`config.json` is the durable harness-owned config file. The initial JSON schema is:

```json
{
  "pullRequestReviewers": ["@copilot"]
}
```

`state/` is reserved for transient harness runtime files such as Codex output scratch directories.

To keep arbitrary repositories clean, the CLI adds `/.agc/` to Git's per-repository exclude file, resolved via `git rev-parse --git-path info/exclude`, and does not mutate tracked `.gitignore` files. That means `.agc/` stays untracked by default, while still living at a predictable repository-local path. The workflow also treats pre-existing `.agc/` files as harness-owned state during cleanliness checks, so stale local harness state does not block a run before the exclude entry is refreshed. If a repository intentionally wants to commit `.agc/`, it can remove that exclude entry and manage ignore rules itself.

## Workflow

Given a single prompt argument, the CLI runs this sequence:

1. Resolve the current repository root with `git rev-parse --show-toplevel`.
2. Read the current branch with `git rev-parse --abbrev-ref HEAD`.
3. Refuse to continue unless the branch is `main` or `master`.
4. Refuse to continue unless `git status --porcelain` shows no changes outside `.agc/`.
5. Resolve Git's per-repository exclude file with `git rev-parse --git-path info/exclude`.
6. Ensure `.agc/` exists, create `.agc/config.json` if missing, and add `/.agc/` to that exclude file.
7. Ask Codex for a feature-branch name using `codex exec` in read-only mode.
8. Fall back to a deterministic slugged branch name if Codex fails or returns invalid output.
9. Create the branch from the current base branch with `git checkout -b <branch> <base>`.
10. Invoke `codex exec` non-interactively to implement the user request.
11. If no files changed, stop cleanly without committing or opening a PR.
12. If files changed, stage everything with `git add --all`.
13. Ask Codex for a one-line commit message and fall back to a deterministic conventional message if needed.
14. Commit and push the branch.
15. Ask Codex for a PR title/body and fall back to a deterministic template if needed.
16. Open the PR with `gh pr create --base ... --head ... --title ... --body ...`.
17. Resolve PR metadata with `gh pr view <branch> --json ...`.
18. Request the configured reviewers with `gh pr edit <number> --add-reviewer <reviewer1,reviewer2>`.
19. Enter the review loop.

## Review Loop

After the PR is created, the CLI enters a deterministic polling loop:

1. Wait 10 minutes.
2. Fetch review comments with:

```bash
gh api --paginate --slurp repos/{owner}/{repo}/pulls/<number>/comments
```

3. Ignore reply comments and ignore comment IDs that were already processed earlier in the same run.
4. Track consecutive no-op polls and exit once the configured `--max-unproductive-polls` threshold is reached.
5. Send only the new actionable comment set to `codex exec` for validation and fixes.
6. If Codex produces no file changes, exit cleanly.
7. If Codex does produce changes, stage, commit, and push them.
8. Only after a successful push, request the configured reviewers again with `gh pr edit <number> --add-reviewer <reviewer1,reviewer2>`.
9. Repeat the loop.

This prevents the tool from reprocessing the same review comments forever.

## Deterministic Fallbacks

The CLI includes code-driven fallbacks for the helper text generation steps:

- branch name fallback: deterministic `feature/<slug>-<hash>`
- commit message fallback: deterministic conventional-commit style summary
- PR title/body fallback: deterministic title plus a short markdown template
- Codex scratch output location: `.agc/state/`

If Codex helper calls fail for those bounded text tasks, the workflow still proceeds.

## Major Failure Conditions

The CLI exits non-zero when:

- the current branch is not `main` or `master`
- the workspace is dirty before the run starts, excluding harness-owned `.agc/` state
- `git`, `gh`, or `codex` commands fail
- `.agc/config.json` is invalid
- branch creation fails
- push fails
- PR creation fails
- configured reviewer request fails in the current GitHub environment

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
