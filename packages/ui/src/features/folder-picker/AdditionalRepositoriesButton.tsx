import { GithubLogo, Plus } from "@phosphor-icons/react";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@posthog/quill";
import { type RefObject, useMemo, useRef } from "react";

interface AdditionalRepositoriesButtonProps {
  values: string[];
  onChange: (values: string[]) => void;
  repositories: string[];
  primaryRepository?: string | null;
  disabled?: boolean;
  anchor?: RefObject<HTMLElement | null>;
}

const VISIBLE_LIMIT = 50;

export function AdditionalRepositoriesButton({
  values,
  onChange,
  repositories,
  primaryRepository,
  disabled = false,
  anchor,
}: AdditionalRepositoriesButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectableRepos = useMemo(
    () => repositories.filter((repo) => repo !== primaryRepository),
    [repositories, primaryRepository],
  );

  const selectedValues = useMemo(
    () => values.filter((repo) => repo !== primaryRepository),
    [values, primaryRepository],
  );
  const count = selectedValues.length;

  if (selectableRepos.length === 0) return null;

  return (
    <Combobox
      items={selectableRepos}
      limit={VISIBLE_LIMIT}
      multiple
      value={selectedValues}
      onValueChange={(next: string[]) =>
        onChange(next.filter((repo) => repo !== primaryRepository))
      }
      disabled={disabled}
    >
      <ComboboxTrigger
        render={
          <Button
            ref={triggerRef}
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="Additional repositories"
          >
            <GithubLogo size={14} weight="regular" className="shrink-0" />
            {count > 0 ? (
              <span className="font-medium tabular-nums">+{count}</span>
            ) : (
              <Plus size={12} weight="bold" className="shrink-0" />
            )}
          </Button>
        }
      />
      <ComboboxContent
        anchor={anchor ?? triggerRef}
        side="bottom"
        sideOffset={6}
        align="start"
        className="min-w-[280px]"
      >
        <ComboboxInput placeholder="Add repositories..." />
        <ComboboxEmpty>No repositories found.</ComboboxEmpty>
        <ComboboxList>
          {(repo: string) => (
            <ComboboxItem key={repo} value={repo}>
              {repo}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
