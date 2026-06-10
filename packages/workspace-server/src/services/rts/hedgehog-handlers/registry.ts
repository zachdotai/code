import type { HedgehogToolName } from "../hedgehog-tools";
import { holdHandler } from "./hold-handler";
import { killHogletHandler } from "./kill-hoglet-handler";
import { linkPrDependencyHandler } from "./link-pr-dependency-handler";
import { markValidatedHandler } from "./mark-validated-handler";
import { messageHogletHandler } from "./message-hoglet-handler";
import { raiseHogletHandler } from "./raise-hoglet-handler";
import { rebaseChildHandler } from "./rebase-child-handler";
import { requestRepositoryAccessHandler } from "./request-repository-access-handler";
import { spawnHogletHandler } from "./spawn-hoglet-handler";
import type { HedgehogToolHandler } from "./types";
import { unlinkPrDependencyHandler } from "./unlink-pr-dependency-handler";
import { writeAuditEntryHandler } from "./write-audit-entry-handler";

const handlerList: readonly HedgehogToolHandler[] = [
  spawnHogletHandler,
  raiseHogletHandler,
  killHogletHandler,
  messageHogletHandler,
  writeAuditEntryHandler,
  holdHandler,
  markValidatedHandler,
  requestRepositoryAccessHandler,
  linkPrDependencyHandler,
  unlinkPrDependencyHandler,
  rebaseChildHandler,
];

export const HEDGEHOG_HANDLERS: ReadonlyMap<
  HedgehogToolName,
  HedgehogToolHandler
> = new Map(handlerList.map((h) => [h.name, h]));
