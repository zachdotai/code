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
import { getWebAttachmentBase64 } from "./web-attachment-store";

// CloudArtifactService + TitleGeneratorService (sessionsModule) depend on a
// handful of clients that, on desktop, read the local filesystem or bundle local
// skills. The cloud-only web host has neither, so these degrade:
//   - attachment bytes come from an in-memory store keyed by the synthetic id
//     the os.saveClipboard* handlers minted (see web-attachment-store)
//   - no local skills dir -> bundling rejects; dependency resolution is a no-op
//     passthrough (skill bundles are always empty on web since skills.list is [])
// The services themselves are portable core and bind unchanged via sessionsModule.

// Resolve an attachment id to its base64 bytes for cloud upload. On web the id
// is a synthetic key into the in-memory store (not a filesystem path).
export const webReadFileAsBase64: ReadFileAsBase64 = (filePath: string) =>
  Promise.resolve(getWebAttachmentBase64(filePath));

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
