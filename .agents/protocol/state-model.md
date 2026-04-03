# State Model

## Goal
This protocol makes the agent team restartable. Any agent should be able to continue work by reading the workspace files, even if the prior run stopped unexpectedly.

## Workspace Root
Create one workspace per initiative:

`.agents/workspaces/<initiative-slug>/`

Use a stable slug that the user can recognize later.

## Required Files
- `initiative-brief.md`
- `status.md`
- `decision-log.md`
- `user-feedback-log.md`

## Common Subdirectories
- `backlog/`: epic, story, and task files.
- `analysis/`: codebase gap analyses.
- `plans/`: implementation plans.
- `execution/`: implementation logs.
- `validation/`: validation reports.

## Canonical File Naming
- `backlog/epic-<epic-id>.md`
- `backlog/story-<story-id>.md`
- `backlog/task-<task-id>.md`
- `analysis/task-<task-id>-gap-analysis.md`
- `plans/task-<task-id>-implementation-plan.md`
- `execution/task-<task-id>-execution-log.md`
- `validation/task-<task-id>-validation-report.md`

## Required State Fields
`status.md` should always answer:
- What initiative is active?
- What backlog item is active?
- Which agent should act next?
- What is the next action?
- What is blocked?
- Which approvals are complete?
- Which artifact or intent summary is currently awaiting user approval?
- What next step has the user explicitly authorized?

`decision-log.md` should record:
- The decision.
- Why it was made.
- Who approved it.
- The date or session reference.

`user-feedback-log.md` should record:
- The user feedback.
- The triggering artifact or question.
- The action taken.
- What approval was requested.
- Whether explicit approval was granted.
- What next step the user authorized.

## Lifecycle
1. Briefing: create `initiative-brief.md`.
2. Shaping: create epic, story, and task files under `backlog/`, then pause for user approval.
3. Exploration: create task gap analysis files under `analysis/`, then pause for user approval.
4. Planning: create task plan files under `plans/`, then pause for user approval.
5. Execution: create task logs under `execution/`, then pause for user approval before handoff.
6. Validation: create task reports under `validation/`, then pause for user approval before closure.
7. Closure or next task: update `status.md` and repeat as needed.

## Approval Loop Protocol
1. The active agent produces an artifact or an intent summary for the next concrete action.
2. The active agent explains the important decisions, assumptions, and tradeoffs to the user.
3. The active agent asks the user for explicit approval to proceed.
4. If the user requests changes, the same agent updates the artifact or intent summary and repeats the approval request.
5. The agent may hand off, end its session, or start the next stage only after explicit approval is recorded in `status.md` and `user-feedback-log.md`.

## Approval Meanings
- Explicit approval is a clear user signal that the agent may proceed, for example approval of the artifact, the plan, the implementation state, or the closure recommendation.
- Silence, missing replies, or the absence of objections do not count as approval.
- Ambiguous replies should be treated as pending clarification, not approval.
- If approval is pending when a session stops, the next run must resume from the approval checkpoint rather than advancing the workflow.

## Resume Rules
- Start every session by reading `status.md`, `decision-log.md`, and `user-feedback-log.md`.
- If a file is stale or contradictory, update it before delegating more work.
- If a stage is complete but not approved, do not advance to the next stage.
- If approval is pending, resume by restating the current artifact or intent summary and asking for approval or revisions.
- If work was interrupted mid-task, continue from the latest plan, execution log, and validation state rather than rebuilding from memory.

## User Approval Rules
- Approval is required after every agent stage, not only at major milestones.
- Approval is required before moving from shaping to exploration.
- Approval is required before moving from exploration to planning.
- Approval is required before moving from planning to implementation.
- Approval is required before moving from implementation to validation.
- Approval is required before closing validation or advancing to the next task.
