import { ContainerModule } from "inversify";
import { ApmEnrichmentService } from "./apmEnrichment";
import { APM_ENRICHMENT_SERVICE } from "./identifiers";

export const apmEnrichmentModule = new ContainerModule(({ bind }) => {
  bind(APM_ENRICHMENT_SERVICE).to(ApmEnrichmentService).inSingletonScope();
});
