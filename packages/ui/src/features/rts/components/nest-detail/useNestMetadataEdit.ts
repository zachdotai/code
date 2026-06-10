import { useHostTRPCClient } from "@posthog/host-router/react";
import type { Nest } from "@posthog/host-router/rts-schemas";
import { logger } from "@posthog/ui/shell/logger";
import { useEffect, useState } from "react";
import { useNestStore } from "../../stores/nestStore";

const log = logger.scope("nest-detail-panel");

export interface UseNestMetadataEditResult {
  name: string;
  setName: (value: string) => void;
  goalPrompt: string;
  setGoalPrompt: (value: string) => void;
  definitionOfDone: string;
  setDefinitionOfDone: (value: string) => void;
  saving: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  canSave: boolean;
  save: () => Promise<void>;
}

export function useNestMetadataEdit(nest: Nest): UseNestMetadataEditResult {
  const [name, setName] = useState(nest.name);
  const hostClient = useHostTRPCClient();
  const [goalPrompt, setGoalPrompt] = useState(nest.goalPrompt);
  const [definitionOfDone, setDefinitionOfDone] = useState(
    nest.definitionOfDone ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(nest.name);
    setGoalPrompt(nest.goalPrompt);
    setDefinitionOfDone(nest.definitionOfDone ?? "");
    setError(null);
  }, [nest]);

  const canSave = name.trim().length > 0 && goalPrompt.trim().length > 0;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await hostClient.rts.nests.update.mutate({
        id: nest.id,
        name: name.trim(),
        goalPrompt: goalPrompt.trim(),
        definitionOfDone: definitionOfDone.trim() || null,
      });
      useNestStore.getState().upsert(updated);
    } catch (e) {
      log.error("Failed to update nest", { id: nest.id, error: e });
      setError(e instanceof Error ? e.message : "Failed to update nest");
    } finally {
      setSaving(false);
    }
  };

  return {
    name,
    setName,
    goalPrompt,
    setGoalPrompt,
    definitionOfDone,
    setDefinitionOfDone,
    saving,
    error,
    setError,
    canSave,
    save,
  };
}
