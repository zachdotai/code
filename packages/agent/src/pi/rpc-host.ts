import { createHarnessRuntime, runRpcMode } from "@posthog/harness";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const runtime = await createHarnessRuntime({
  cwd: process.cwd(),
  apiKey: process.env.POSTHOG_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY,
});

const requestedModel = argumentValue("--model")?.replace(/^posthog\//, "");
if (requestedModel) {
  const model = runtime.services.modelRegistry.find("posthog", requestedModel);
  if (!model) {
    throw new Error(`PostHog model not found: ${requestedModel}`);
  }
  await runtime.session.setModel(model);
}

await runRpcMode(runtime);
