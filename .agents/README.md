# Solo EM Agent Team

This package defines a custom multi-agent workflow for a solo Engineering Manager who wants a restartable, file-based delivery process.

The split is intentional:
- Agent instruction files live under [`.github/agents`](../.github/agents/).
- Durable team-owned state, protocol, templates, and workspaces live under [`.agents`](./).
- Repo-wide agent guidance remains in [`AGENTS.md`](../AGENTS.md).

## Team
- [Orchestrator](../.github/agents/orchestrator.md): Owns sequencing, state, approvals, and restartability.
- [Backlog Architect](../.github/agents/backlog-architect.md): Turns rough prompts into polished epics, stories, tasks, and acceptance criteria.
- [Codebase Explorer](../.github/agents/codebase-explorer.md): Explores the codebase and documents the gap between current and desired behavior.
- [Implementation Planner](../.github/agents/implementation-planner.md): Produces high-level and low-level plans for a single task.
- [Software Engineer](../.github/agents/software-engineer.md): Implements the approved plan and logs deviations.
- [QA Validator](../.github/agents/qa-validator.md): Verifies acceptance criteria and records evidence.

## Operating Model
1. The Orchestrator creates a workspace under `.agents/workspaces/<initiative-slug>/`.
2. The responsible agent explains what it plans to do or what it has completed, then asks the user for explicit approval.
3. If the user requests changes, the same agent revises its artifact or intent summary and asks again.
4. The Backlog Architect shapes the request into tracker-ready backlog artifacts and pauses for approval before handoff.
5. The Codebase Explorer documents the current state, gaps, risks, and likely change surfaces and pauses for approval before handoff.
6. The Implementation Planner creates a task plan and pauses for approval before the Software Engineer starts.
7. The Software Engineer implements the approved task, explains what changed, and pauses for approval before handoff.
8. The QA Validator checks acceptance criteria, presents the verdict, and pauses for approval before closure.
9. The Orchestrator advances the next task only after the current stage has explicit user approval recorded in the workspace.

## Core Principles
- File-first state: no agent may rely on conversational memory as the source of truth.
- Explicit approval loop: every agent must explain its current output or intended next action, ask for explicit approval, and keep iterating until approval is granted.
- No surprise starts or handoffs: no agent may begin a materially new stage, finish a session, or hand work to another agent without making that transition visible to the user first.
- Communicative by default: agents must summarize intent, decisions, tradeoffs, and current status clearly enough that the user always knows what is happening.
- Sequential task delivery: planning, implementation, and validation happen task by task, not as a batch.
- Restartability: every agent must be able to resume from the workspace files alone.
- Harness neutrality inside the instructions: role files refer to capability classes, not tool names.

## Start Here
- Read [state-model.md](protocol/state-model.md).
- Create a new workspace using the templates in [templates](templates/).
- Load the relevant role file from [`.github/agents`](../.github/agents/).
