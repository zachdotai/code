import type { HogletRepository } from "../domain/HogletRepository";
import { useHogletStore } from "../stores/hogletStore";

export const zustandHogletRepository: HogletRepository = {
  findInBucket(bucket, hogletId) {
    const bucketList = useHogletStore.getState().byBucket[bucket];
    return bucketList?.find((h) => h.id === hogletId) ?? null;
  },
  upsert(bucket, hoglet) {
    useHogletStore.getState().upsert(bucket, hoglet);
  },
  remove(bucket, hogletId) {
    useHogletStore.getState().remove(bucket, hogletId);
  },
  setBucket(bucket, hoglets) {
    useHogletStore.getState().setBucket(bucket, hoglets);
  },
  startDying(hogletId, x, y) {
    useHogletStore.getState().startDying(hogletId, x, y);
  },
  setTaskSummaries(summaries) {
    useHogletStore.getState().setTaskSummaries(summaries);
  },
  collectTaskIds() {
    const ids = new Set<string>();
    const { byBucket } = useHogletStore.getState();
    for (const bucket of Object.values(byBucket)) {
      for (const h of bucket) ids.add(h.taskId);
    }
    return [...ids];
  },
};
