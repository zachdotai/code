import { ContainerModule } from "inversify";
import { TASK_MUTATION_SERVICE, TaskMutationService } from "./taskMutations";

export const tasksLocalCoreModule = new ContainerModule(({ bind }) => {
  bind(TaskMutationService).toSelf().inSingletonScope();
  bind(TASK_MUTATION_SERVICE).toService(TaskMutationService);
});
