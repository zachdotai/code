import type { EditorState } from "@tiptap/pm/state";
import { PluginKey } from "@tiptap/pm/state";
import type { CommandSuggestionItem } from "../types";

interface GhostMatch {
  slashPos: number;
  cursorPos: number;
  query: string;
  item: CommandSuggestionItem;
}

interface PluginState {
  ghost: GhostMatch | null;
  dismissedAt: number | null;
}

type GhostMeta = { type: "dismiss" } | { type: "reset" };

const pluginKey = new PluginKey<PluginState>("commandGhostText");
const _SLASH_QUERY_REGEX = /(?:^|\s)\/([^\s/]+)$/;

const _getGhost = (state: EditorState): GhostMatch | null =>
  pluginKey.getState(state)?.ghost ?? null;
