import type { ReadFileAsBase64 } from "@posthog/core/editor/cloud-prompt";
import type {
  BundleLocalSkill,
  ResolveSkillBundleDependencies,
} from "@posthog/core/sessions/cloudArtifactIdentifiers";
import type {
  FileReadClient,
  TitleGeneratorLogger,
} from "@posthog/core/sessions/titleGeneratorIdentifiers";
import type { RootLogger } from "@posthog/di/logger";

// CloudArtifactService + TitleGeneratorService (sessionsModule) depend on a
// handful of clients that, on desktop, read the local filesystem or bundle local
// skills. The cloud-only web host has neither, so these degrade:
//   - no local file to read for an attachment upload -> null / reject
//   - no local skills dir -> bundling rejects; dependency resolution is a no-op
//     passthrough (skill bundles are always empty on web since skills.list is [])
// The services themselves are portable core and bind unchanged via sessionsModule.

// Reading a local attachment file as base64: no local files on web.
export const webReadFileAsBase64: ReadFileAsBase64 = () =>
  Promise.resolve(null);

export const webBundleLocalSkill: BundleLocalSkill = () =>
  Promise.reject(new Error("Local skill bundling is not available on the web"));

// Passthrough: never expand (there are no local skills to pull deps from), but
// don't drop whatever was passed in.
export const webResolveSkillBundleDependencies: ResolveSkillBundleDependencies =
  (refs) => Promise.resolve(refs);

// Title generator reads referenced files to enrich the title prompt; none exist
// locally on web.
export const webTitleGeneratorFileReadClient: FileReadClient = {
  readAbsoluteFile: () => Promise.resolve(null),
};

export function webTitleGeneratorLogger(
  logger: RootLogger,
): TitleGeneratorLogger {
  const scoped = logger.scope("title-generator");
  return { error: (message, data) => scoped.error(message, data) };
}
