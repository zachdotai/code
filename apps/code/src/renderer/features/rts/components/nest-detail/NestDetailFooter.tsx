import { KeyHint } from "@components/ui/KeyHint";
import { useFunSpeak } from "@features/fun-mode/hooks/useFunSpeak";
import { Archive, FloppyDisk } from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import type { NestLifecycle } from "../../utils/nestLifecycle";
import { CommandConsole } from "../CommandConsole";

interface NestDetailFooterProps {
  lifecycle: NestLifecycle;
  editable: boolean;
  canSave: boolean;
  saving: boolean;
  archiving: boolean;
  onSave: () => void;
  onArchive: () => void;
  onOpenCompactDialog: () => void;
}

export function NestDetailFooter({
  lifecycle,
  editable,
  canSave,
  saving,
  archiving,
  onSave,
  onArchive,
  onOpenCompactDialog,
}: NestDetailFooterProps) {
  const t = useFunSpeak();
  return (
    <CommandConsole.Footer align="end">
      {editable && (
        <Button
          onClick={onSave}
          disabled={!canSave || saving || archiving}
          loading={saving}
          size="2"
          title="Save (S)"
        >
          <FloppyDisk size={14} />
          {t("Save")}
          <KeyHint className="ml-1">S</KeyHint>
        </Button>
      )}
      {lifecycle === "validated" && (
        <Button
          color="gray"
          variant="soft"
          onClick={onOpenCompactDialog}
          disabled={saving || archiving}
          size="2"
        >
          <Archive size={14} />
          Compact nest
        </Button>
      )}
      {lifecycle !== "dormant" && lifecycle !== "archived" && (
        <Button
          variant="soft"
          color="red"
          onClick={onArchive}
          disabled={saving || archiving}
          loading={archiving}
          size="2"
          title="Archive (A)"
        >
          <Archive size={14} />
          {t("Archive")}
          <KeyHint className="ml-1">A</KeyHint>
        </Button>
      )}
    </CommandConsole.Footer>
  );
}
