# Workspaces

Create one subdirectory here per initiative, for example:

- `.agents/workspaces/auth-hardening/`
- `.agents/workspaces/billing-admin-dashboard/`
- `.agents/workspaces/telegram-bot-onboarding/`

Each workspace should follow the structure defined in [state-model.md](../protocol/state-model.md) and should be bootstrapped from the templates in [templates](../templates/).

The workspace is the durable handoff mechanism between agents. If the chat session ends, a new run should be able to resume from the workspace files alone.

Approval checkpoints are part of that state. The active artifact, the user feedback on it, and the next authorized step should always be recoverable from `status.md` and `user-feedback-log.md`.
