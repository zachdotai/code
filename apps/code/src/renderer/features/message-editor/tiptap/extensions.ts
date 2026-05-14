import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { createCommandGhostText } from "./CommandGhostText";
import { createCommandMention } from "./CommandMention";
import { createFileMention } from "./FileMention";
import { createIssueMention } from "./IssueMention";
import { MentionChipNode } from "./MentionChipNode";
import { createTeamMemberMention } from "./TeamMemberMention";

export interface EditorExtensionsOptions {
  sessionId: string;
  placeholder?: string;
  fileMentions?: boolean;
  issueMentions?: boolean;
  commands?: boolean;
  teamMentions?: boolean;
}

export function getEditorExtensions(options: EditorExtensionsOptions) {
  const {
    sessionId,
    placeholder = "",
    fileMentions = true,
    issueMentions = true,
    commands = true,
    teamMentions = false,
  } = options;

  const extensions = [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
    }),
    Placeholder.configure({ placeholder }),
    MentionChipNode,
  ];

  // teamMentions and fileMentions both claim the `@` trigger. When team mentions
  // are enabled (Work-mode threads) the editor uses `@` for people; file mentions
  // are not registered to avoid a double-claim on the trigger character.
  if (teamMentions) {
    extensions.push(createTeamMemberMention());
  } else if (fileMentions) {
    extensions.push(createFileMention(sessionId));
  }

  if (issueMentions) {
    extensions.push(createIssueMention(sessionId));
  }

  if (commands) {
    extensions.push(createCommandMention({ sessionId }));
    extensions.push(createCommandGhostText(sessionId));
  }

  return extensions;
}
