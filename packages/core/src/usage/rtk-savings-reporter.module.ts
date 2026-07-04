import { ContainerModule } from "inversify";
import { RTK_SAVINGS_REPORTER_SERVICE } from "./identifiers";
import { RtkSavingsReporter } from "./rtk-savings-reporter";

export const rtkSavingsReporterModule = new ContainerModule(({ bind }) => {
  bind(RTK_SAVINGS_REPORTER_SERVICE).to(RtkSavingsReporter).inSingletonScope();
});
