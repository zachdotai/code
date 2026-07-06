import { ContainerModule } from "inversify";
import { EntityRegistry } from "./entityRegistry";
import { ENTITY_REGISTRY, LOCAL_STORE_SERVICE, PERSISTER } from "./identifiers";
import { LocalStoreService } from "./localStoreService";
import { Persister } from "./persister";

export const localStoreCoreModule = new ContainerModule(({ bind }) => {
  bind(EntityRegistry).toSelf().inSingletonScope();
  bind(ENTITY_REGISTRY).toService(EntityRegistry);

  bind(Persister).toSelf().inSingletonScope();
  bind(PERSISTER).toService(Persister);

  bind(LocalStoreService).toSelf().inSingletonScope();
  bind(LOCAL_STORE_SERVICE).toService(LocalStoreService);
});
