import type { McpRecommendedServer } from "@renderer/api/posthogClient";

export type LocalMcpTemplate = McpRecommendedServer & {
  id: `local:${string}`;
};

export const LOCAL_TEMPLATE_PREFIX = "local:" as const;

export function isLocalTemplateId(id: string): id is `local:${string}` {
  return id.startsWith(LOCAL_TEMPLATE_PREFIX);
}

export const LOCAL_MCP_TEMPLATES: LocalMcpTemplate[] = [
  {
    id: "local:asana",
    name: "Asana",
    url: "https://mcp.asana.com/v2/mcp",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "asana",
    description:
      "Manage Asana projects, tasks, and teams. Requires a pre-registered OAuth app — add your client ID and secret under the optional authentication fields.",
    docs_url: "https://developers.asana.com/docs/using-asanas-mcp-server",
  },
  {
    id: "local:gmail",
    name: "Gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "gmail",
    description:
      "Search, read, and compose Gmail messages. Requires an OAuth client created in Google Cloud — add your client ID and secret under the optional authentication fields.",
    docs_url:
      "https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server",
  },
  {
    id: "local:google_calendar",
    name: "Google Calendar",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "google_calendar",
    description:
      "Read and manage Google Calendar events. Requires an OAuth client created in Google Cloud — add your client ID and secret under the optional authentication fields.",
    docs_url:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
  },
  {
    id: "local:google_drive",
    name: "Google Drive",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "google_drive",
    description:
      "Browse and read files in Google Drive (including Docs, Sheets, and Slides). Requires an OAuth client created in Google Cloud — add your client ID and secret under the optional authentication fields.",
    docs_url:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
  },
  {
    id: "local:granola",
    name: "Granola",
    url: "https://mcp.granola.ai/mcp",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "granola",
    description:
      "Access Granola meeting notes and transcripts. Uses Dynamic Client Registration — no additional credentials required.",
    docs_url: "https://docs.granola.ai/help-center/sharing/integrations/mcp",
  },
  {
    id: "local:slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    auth_type: "oauth",
    category: "productivity",
    icon_key: "slack",
    description:
      "Search Slack messages, channels, and threads with Real-time Search. Requires a directory-published or internal Slack app — add your client ID and secret under the optional authentication fields.",
    docs_url: "https://docs.slack.dev/ai/slack-mcp-server/",
  },
];
