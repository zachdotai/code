import { ContainerModule } from "inversify";
import { EntityRegistry } from "./entityRegistry";
import { ENTITY_REGISTRY, LOCAL_STORE_SERVICE, PERSISTER } from "./identifiers";
import { LocalStoreService } from "./localStoreService";
import { OUTBOX, OUTBOX_FLUSHER } from "./outbox/identifiers";
import { Outbox } from "./outbox/outbox";
import { OutboxFlusher } from "./outbox/outboxFlusher";
import { Persister } from "./persister";
import { ApplyPipeline } from "./sync/applyPipeline";
import {
  APPLY_PIPELINE,
  SYNC_ENGINE,
  SYNC_SCHEDULER,
} from "./sync/identifiers";
import { SyncEngine } from "./sync/syncEngine";
import { SyncScheduler } from "./sync/syncScheduler";

export const localStoreCoreModule = new ContainerModule(({ bind }) => {
  bind(EntityRegistry).toSelf().inSingletonScope();
  bind(ENTITY_REGISTRY).toService(EntityRegistry);

  bind(Persister).toSelf().inSingletonScope();
  bind(PERSISTER).toService(Persister);

  bind(LocalStoreService).toSelf().inSingletonScope();
  bind(LOCAL_STORE_SERVICE).toService(LocalStoreService);

  bind(ApplyPipeline).toSelf().inSingletonScope();
  bind(APPLY_PIPELINE).toService(ApplyPipeline);

  bind(SyncScheduler).toSelf().inSingletonScope();
  bind(SYNC_SCHEDULER).toService(SyncScheduler);

  bind(SyncEngine).toSelf().inSingletonScope();
  bind(SYNC_ENGINE).toService(SyncEngine);

  bind(Outbox).toSelf().inSingletonScope();
  bind(OUTBOX).toService(Outbox);

  bind(OutboxFlusher).toSelf().inSingletonScope();
  bind(OUTBOX_FLUSHER).toService(OutboxFlusher);
});
