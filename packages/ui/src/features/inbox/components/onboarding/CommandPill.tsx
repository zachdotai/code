import { Check, Copy } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";
import { IconButton } from "@radix-ui/themes";
import { useCallback, useState } from "react";

interface CommandPillProps {
  command: string;
  className?: string;
}

/**
 * The single self-driving setup command as a click-to-copy pill with the PostHog
 * rainbow gradient — the one call-to-action of the onboarding. Mirrors Cloud's
 * rainbow command block rather than the plain `CodeBlock`.
 */
export function CommandPill({ command, className }: CommandPillProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-2",
        className,
      )}
    >
      <span className="select-none text-(--gray-9)">$</span>
      <code className="rainbow-text rainbow-text-animating flex-1 overflow-x-auto whitespace-nowrap font-[var(--code-font-family)] font-medium text-[13px]">
        {command}
      </code>
      <IconButton
        size="1"
        variant="ghost"
        color="gray"
        onClick={handleCopy}
        className="shrink-0 cursor-pointer"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}
