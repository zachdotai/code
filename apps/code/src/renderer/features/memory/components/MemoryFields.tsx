import { LinkSimple, Trash } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useRef } from "react";

export interface PersonAnswer {
  id: string;
  name: string;
  role: string;
  notes: string;
}

interface ShortFieldProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}

export function ShortField({
  label,
  placeholder,
  value,
  onChange,
  optional,
}: ShortFieldProps) {
  return (
    <Box>
      {label && (
        <Flex align="baseline" gap="2" className="mb-1">
          <Text className="text-[12px] text-gray-11">{label}</Text>
          {optional && (
            <Text className="text-[11px] text-gray-9">optional</Text>
          )}
        </Flex>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none placeholder:text-gray-8 focus:border-gray-8"
      />
    </Box>
  );
}

interface LongFieldProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  rows?: number;
  hideLinkButton?: boolean;
}

export function LongField({
  label,
  placeholder,
  value,
  onChange,
  optional,
  rows = 3,
  hideLinkButton,
}: LongFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleInsertLink = () => {
    const url = window.prompt("URL");
    if (!url) return;
    const linkLabel = window.prompt("Link text", url) ?? url;
    const ta = ref.current;
    const snippet = `[${linkLabel}](${url})`;
    if (!ta) {
      onChange(`${value}${snippet}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    onChange(next);
    setTimeout(() => {
      ta.focus();
      const cursor = start + snippet.length;
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  return (
    <Box>
      {(label || !hideLinkButton) && (
        <Flex align="baseline" justify="between" gap="2" className="mb-1">
          <Flex align="baseline" gap="2">
            {label && <Text className="text-[12px] text-gray-11">{label}</Text>}
            {optional && (
              <Text className="text-[11px] text-gray-9">optional</Text>
            )}
          </Flex>
          {!hideLinkButton && (
            <button
              type="button"
              onClick={handleInsertLink}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-gray-10 hover:bg-gray-3 hover:text-gray-12"
            >
              <LinkSimple size={11} />
              Add link
            </button>
          )}
        </Flex>
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none placeholder:text-gray-8 focus:border-gray-8"
      />
    </Box>
  );
}

interface PersonCardProps {
  person: PersonAnswer;
  onChange: (patch: Partial<PersonAnswer>) => void;
  onRemove: () => void;
}

export function PersonCard({ person, onChange, onRemove }: PersonCardProps) {
  return (
    <Box className="rounded border border-gray-5 bg-gray-2 p-3">
      <Flex align="center" justify="between" gap="2" className="mb-2">
        <Text className="text-[11px] text-gray-10 uppercase tracking-wide">
          Person
        </Text>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-gray-10 hover:bg-gray-3 hover:text-gray-12"
          title="Remove"
        >
          <Trash size={12} />
        </button>
      </Flex>
      <Flex direction="column" gap="2">
        <input
          type="text"
          value={person.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Full name"
          className="w-full rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none focus:border-gray-8"
        />
        <input
          type="text"
          value={person.role}
          onChange={(e) => onChange({ role: e.target.value })}
          placeholder="Role / how you work together"
          className="w-full rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none focus:border-gray-8"
        />
        <textarea
          value={person.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Anything else worth knowing — links to their profile / Slack / current focus."
          rows={2}
          className="w-full resize-y rounded border border-gray-5 bg-transparent px-2 py-1.5 text-[13px] text-gray-12 outline-none placeholder:text-gray-8 focus:border-gray-8"
        />
      </Flex>
    </Box>
  );
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "") || "person"
  );
}

export function renderPersonMd(p: PersonAnswer): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${p.name}`);
  if (p.role) lines.push(`description: ${p.role}`);
  lines.push("type: person");
  lines.push("---");
  lines.push("");
  lines.push(`# ${p.name}`);
  lines.push("");
  if (p.role) {
    lines.push(`**Role:** ${p.role}`);
    lines.push("");
  }
  if (p.notes.trim()) {
    lines.push(p.notes.trim());
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Pulls structured fields back out of a person markdown body so we can
 * round-trip into the PersonCard editor.
 */
export function parsePersonMd(content: string): {
  name: string;
  role: string;
  notes: string;
} {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  let name = "";
  let role = "";
  if (fmMatch) {
    const fm = fmMatch[1];
    name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
    role = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  }
  let body = fmMatch ? content.slice(fmMatch[0].length) : content;
  body = body
    .replace(/^#\s+[^\n]*\n+/, "")
    .replace(/^\*\*Role:\*\*\s+[^\n]*\n+/, "")
    .trim();
  return { name, role, notes: body };
}
