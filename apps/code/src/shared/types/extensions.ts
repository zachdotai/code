export interface ExtensionCommandContribution {
  extensionId: string;
  name: string;
  description: string;
  input?: { hint: string };
}

export interface ExtensionPromptContribution {
  extensionId: string;
  name: string;
  description: string;
  input?: { hint: string };
}

export interface ExtensionToolContribution {
  extensionId: string;
  name: string;
  description: string;
}

export interface ExtensionSidebarContribution {
  extensionId: string;
  id: string;
  title: string;
  icon?: string;
  entry?: string;
  url?: string;
  html?: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  installPath: string;
  commands: ExtensionCommandContribution[];
  prompts: ExtensionPromptContribution[];
  tools?: ExtensionToolContribution[];
  sidebar: ExtensionSidebarContribution[];
  skillCount: number;
  loadErrors: string[];
}

export interface ExtensionChangedPayload {
  extensions: ExtensionInfo[];
}
