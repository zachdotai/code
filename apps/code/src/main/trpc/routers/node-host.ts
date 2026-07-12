import { container } from "../../di/container";
import { NODE_HOST_SERVICE } from "../../di/tokens";
import {
  NodeHostEvent,
  type NodeHostService,
} from "../../services/node-host/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<NodeHostService>(NODE_HOST_SERVICE);

export const nodeHostRouter = router({
  getStatus: publicProcedure.query(() => getService().getStatusSnapshot()),

  restart: publicProcedure.mutation(async () => {
    await getService().restart();
  }),

  onStatusChanged: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(NodeHostEvent.StatusChanged, {
      signal: opts.signal,
    });
    // toIterable attaches its listener on the first pull. Prime it before
    // reading the snapshot so a transition in between is buffered, not dropped.
    const firstEvent = iterable.next();
    yield service.getStatusSnapshot();
    try {
      let result = await firstEvent;
      while (!result.done) {
        yield result.value;
        result = await iterable.next();
      }
    } finally {
      await iterable.return?.(undefined);
    }
  }),
});
