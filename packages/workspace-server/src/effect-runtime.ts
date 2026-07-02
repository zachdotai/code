import { Layer } from "effect";
import { makeEffectRuntime } from "./effect-runtime-factory";
import { Connectivity } from "./services/connectivity/service";

/**
 * Every converted Effect service's live layer goes here — the single place the
 * workspace-server process composes its Effect services. Grows as more migrate.
 */
const AppLayer = Layer.mergeAll(Connectivity.Live);

export const { runService, runServiceStream, start, stop } =
  makeEffectRuntime(AppLayer);
