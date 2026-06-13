import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type CurrentUser = {
  email: string;
  first_name?: string;
  last_name?: string;
  organizations?: unknown[];
};

let currentUser: CurrentUser | undefined;
let switchPending = false;

const authState = {
  status: "authenticated" as const,
  bootstrapComplete: true,
  cloudRegion: "us" as const,
  orgProjectsMap: {
    "org-1": { orgName: "Acme", projects: [{ id: 1, name: "Main" }] },
  } as Record<
    string,
    { orgName: string; projects: { id: number; name: string }[] }
  >,
  currentOrgId: "org-1" as string | null,
  currentProjectId: 1 as number | null,
  hasCodeAccess: true,
  needsScopeReauth: false,
};

vi.mock("@posthog/ui/features/auth/store", () => ({
  useAuthStateValue: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

vi.mock("@posthog/ui/features/auth/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: currentUser, isPlaceholderData: false }),
}));

vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => null,
}));

vi.mock("@posthog/ui/features/auth/useAuthMutations", () => ({
  useSelectProjectMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useSwitchOrgMutation: () => ({ mutate: vi.fn(), isPending: switchPending }),
  useLogoutMutation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@posthog/ui/shell/openExternal", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@posthog/ui/features/settings/hooks/useOpenSettings", () => ({
  openSettings: vi.fn(),
}));
vi.mock("@posthog/ui/utils/urls", () => ({ getPostHogUrl: () => null }));

import { ProjectSwitcher } from "./ProjectSwitcher";

function renderSwitcher() {
  return render(
    <Theme>
      <ProjectSwitcher />
    </Theme>,
  );
}

describe("ProjectSwitcher trigger", () => {
  afterEach(() => {
    vi.clearAllMocks();
    currentUser = undefined;
    switchPending = false;
    authState.currentProjectId = 1;
    authState.currentOrgId = "org-1";
  });

  it("shows a skeleton, never the literal 'No email', while the user loads", () => {
    currentUser = undefined;
    renderSwitcher();

    expect(screen.getAllByText("Main").length).toBeGreaterThan(0);
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("No email")).not.toBeInTheDocument();
  });

  it("paints the email once the user resolves", () => {
    currentUser = { email: "alice@example.com" };
    renderSwitcher();

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).not.toBeInTheDocument();
  });

  it("shows a spinner instead of the chevron while a switch is in flight", () => {
    // Fake timers keep the spinner's animation interval from firing state
    // updates outside act(); render still paints the current braille frame.
    vi.useFakeTimers();
    try {
      currentUser = { email: "alice@example.com" };
      switchPending = true;
      renderSwitcher();

      expect(document.querySelector(".rotate-270")).toBeNull();
      expect(screen.getByText(/[⠀-⣿]/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
