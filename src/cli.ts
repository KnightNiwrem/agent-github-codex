import { runAgentLoop } from "./agent-loop";
import { createRuntimeClients } from "./runtime";

export const parsePrompt = (argv: string[]): string => argv.join(" ").trim();

export const parseReviewWaitMinutes = (value: string | undefined): number => {
  if (!value) {
    return 10;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("AGENT_LOOP_REVIEW_WAIT_MINUTES must be a positive number");
  }

  return parsed;
};

export const runCli = async (
  argv = process.argv.slice(2),
  cwd = process.cwd(),
): Promise<void> => {
  const prompt = parsePrompt(argv);

  if (!prompt) {
    throw new Error('Usage: agent-github-codex "<prompt>"');
  }

  const clients = createRuntimeClients(cwd);
  const result = await runAgentLoop(
    {
      branchPrefix: process.env.AGENT_LOOP_BRANCH_PREFIX ?? "feature",
      commitPrefix: process.env.AGENT_LOOP_COMMIT_PREFIX ?? "feat",
      logger: { info: (message) => console.log(message) },
      prompt,
      reviewWaitMinutes: parseReviewWaitMinutes(
        process.env.AGENT_LOOP_REVIEW_WAIT_MINUTES,
      ),
      sleep: (milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }),
    },
    clients,
  );

  console.log(JSON.stringify(result, null, 2));
};

export const handleCliError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
  throw error;
};
