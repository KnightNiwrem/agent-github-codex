# copilot-bun

A Bun-based agent harness that uses Bun shell commands, `codex exec`, git, and `gh` to implement a task, open a pull request, and iterate on automated PR review feedback.

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) installed on your machine
- [Docker](https://www.docker.com/) (optional, for containerized deployment)

### Installation

```bash
# Install dependencies
bun install
```

### CLI Installation

For a global CLI install from this checkout:

```bash
bun link
```

That exposes:

```bash
agent-github-codex "Implement the requested change"
```

You can also install it globally from a package source with Bun:

```bash
bun install -g agent-github-codex
```

### Development

```bash
# Run the agent loop
bun run agent -- "Implement the requested change"

# Run with watch mode
bun dev
```

The harness expects a clean git worktree before it starts. Its default flow is:

1. If the current branch is `main` or `master`, create a new `feature/<slug>` branch.
2. Run `codex exec --full-auto` with the provided prompt.
3. If files changed, `git add`, `git commit`, `git push`, and open a PR with `gh pr create`.
4. Wait 10 minutes, collect new PR review comments with `gh api`, and resume the last Codex session with `codex exec resume --last`.
5. If Codex makes valid follow-up fixes, commit/push them, comment `@copilot review`, and repeat.
6. Stop when there are no new review comments or Codex produces no additional changes.

### Environment knobs

The following environment variables are supported:

- `AGENT_LOOP_BRANCH_PREFIX` default `feature`
- `AGENT_LOOP_COMMIT_PREFIX` default `feat`
- `AGENT_LOOP_REVIEW_WAIT_MINUTES` default `10`

### Prerequisites for automation

- `codex` must be installed and authenticated
- `gh` must be installed and authenticated
- the repository must have an `origin` remote that points at GitHub
- the local worktree must be clean before starting the loop
- your global Bun bin directory must be on `PATH` for the installed CLI to resolve

### Code Quality

Always run the following commands before completing any tasks:

```bash
# Run checks
bun run check

# Fix Biome issues
bun run check:fix

# Run type checking
bun typecheck
```

Make sure checks, type checking, and tests pass successfully before submitting your work.

### Docker

This project can be run in a Docker container:

```bash
# Build and start the container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```
