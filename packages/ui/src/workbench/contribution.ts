import type { Container } from "inversify";

export interface WorkbenchContribution {
  start(): void | Promise<void>;
}

export const WORKBENCH_CONTRIBUTION = Symbol.for(
  "posthog.workbenchContribution",
);

export async function startWorkbenchContributions(
  container: Container,
): Promise<void> {
  if (!container.isBound(WORKBENCH_CONTRIBUTION)) {
    return;
  }

  const contributions = container.getAll<WorkbenchContribution>(
    WORKBENCH_CONTRIBUTION,
  );

  for (const contribution of contributions) {
    await contribution.start();
  }
}
