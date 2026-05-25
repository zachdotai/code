import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthState = {
  cloudRegion: string | null;
  orgProjectsMap: Record<
    string,
    { orgName: string; projects: { id: number; name: string }[] }
  >;
  currentOrgId: string | null;
};

let mockAuthState: AuthState = {
  cloudRegion: "us",
  orgProjectsMap: {},
  currentOrgId: null,
};

const switchOrgMutate = vi.fn();
const selectProjectMutate = vi.fn();
const logoutMutate = vi.fn();
const openSettings = vi.fn();
const navigateToTaskInput = vi.fn();
let switchOrgPending = false;

vi.mock("@features/auth/hooks/authClient", () => ({
  useOptionalAuthenticatedClient: () => null,
}));

vi.mock("@features/auth/hooks/authMutations", () => ({
  useLogoutMutation: () => ({ mutate: logoutMutate }),
  useSelectProjectMutation: () => ({ mutate: selectProjectMutate }),
  useSwitchOrgMutation: () => ({
    mutate: switchOrgMutate,
    isPending: switchOrgPending,
  }),
}));

vi.mock("@stores/navigationStore", () => ({
  useNavigationStore: {
    getState: () => ({ navigateToTaskInput }),
  },
}));

vi.mock("@features/auth/hooks/authQueries", () => ({
  useAuthStateValue: (selector: (state: AuthState) => unknown) =>
    selector(mockAuthState),
  useCurrentUser: () => ({
    data: { email: "user@example.com", first_name: "Test", last_name: "User" },
  }),
}));

vi.mock("@features/projects/hooks/useProjects", () => ({
  useProjects: () => ({
    groupedProjects: [],
    currentProject: { id: 42, name: "Demo project" },
    currentProjectId: 42,
  }),
}));

vi.mock("@features/settings/stores/settingsDialogStore", () => ({
  useSettingsDialogStore: (
    selector: (state: { open: typeof openSettings }) => unknown,
  ) => selector({ open: openSettings }),
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    os: { openExternal: { mutate: vi.fn() } },
  },
}));

import { ProjectSwitcher } from "./ProjectSwitcher";

function renderInTheme() {
  return render(
    <Theme>
      <ProjectSwitcher />
    </Theme>,
  );
}

describe("ProjectSwitcher org switcher", () => {
  beforeEach(() => {
    switchOrgMutate.mockReset();
    selectProjectMutate.mockReset();
    logoutMutate.mockReset();
    openSettings.mockReset();
    navigateToTaskInput.mockReset();
    switchOrgPending = false;
  });

  it("hides the Switch organization submenu when there is only one org", async () => {
    mockAuthState = {
      cloudRegion: "us",
      currentOrgId: "org-1",
      orgProjectsMap: {
        "org-1": { orgName: "Solo Org", projects: [{ id: 42, name: "P1" }] },
      },
    };

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderInTheme();

    await user.click(screen.getByText("Demo project"));

    expect(screen.queryByText("Switch organization")).not.toBeInTheDocument();
  });

  it("shows the submenu with every org and marks the current one", async () => {
    mockAuthState = {
      cloudRegion: "us",
      currentOrgId: "org-1",
      orgProjectsMap: {
        "org-1": { orgName: "Alpha", projects: [{ id: 1, name: "P1" }] },
        "org-2": { orgName: "Beta", projects: [{ id: 2, name: "P2" }] },
      },
    };

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderInTheme();

    await user.click(screen.getByText("Demo project"));
    await user.hover(await screen.findByText("Switch organization"));

    const alpha = await screen.findByRole("menuitem", { name: /Alpha/ });
    const beta = await screen.findByRole("menuitem", { name: /Beta/ });
    expect(alpha).toBeInTheDocument();
    expect(beta).toBeInTheDocument();

    expect(alpha.querySelector("svg")).not.toBeNull();
    expect(beta.querySelector("svg")).toBeNull();
  });

  it("fires switchOrg.mutate when picking a different org and navigates on success", async () => {
    mockAuthState = {
      cloudRegion: "us",
      currentOrgId: "org-1",
      orgProjectsMap: {
        "org-1": { orgName: "Alpha", projects: [{ id: 1, name: "P1" }] },
        "org-2": { orgName: "Beta", projects: [{ id: 2, name: "P2" }] },
      },
    };

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderInTheme();

    await user.click(screen.getByText("Demo project"));
    await user.hover(await screen.findByText("Switch organization"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Beta/ }));

    expect(switchOrgMutate).toHaveBeenCalledTimes(1);
    expect(switchOrgMutate).toHaveBeenCalledWith(
      "org-2",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const onSuccess = switchOrgMutate.mock.calls[0]?.[1]?.onSuccess;
    onSuccess?.();
    expect(navigateToTaskInput).toHaveBeenCalledTimes(1);
  });

  it("skips switchOrg.mutate while a previous switch is pending", async () => {
    switchOrgPending = true;
    mockAuthState = {
      cloudRegion: "us",
      currentOrgId: "org-1",
      orgProjectsMap: {
        "org-1": { orgName: "Alpha", projects: [{ id: 1, name: "P1" }] },
        "org-2": { orgName: "Beta", projects: [{ id: 2, name: "P2" }] },
      },
    };

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderInTheme();

    await user.click(screen.getByText("Demo project"));
    await user.hover(await screen.findByText("Switch organization"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Beta/ }));

    expect(switchOrgMutate).not.toHaveBeenCalled();
  });

  it("does not call switchOrg when clicking the active org", async () => {
    mockAuthState = {
      cloudRegion: "us",
      currentOrgId: "org-1",
      orgProjectsMap: {
        "org-1": { orgName: "Alpha", projects: [{ id: 1, name: "P1" }] },
        "org-2": { orgName: "Beta", projects: [{ id: 2, name: "P2" }] },
      },
    };

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderInTheme();

    await user.click(screen.getByText("Demo project"));
    await user.hover(await screen.findByText("Switch organization"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Alpha/ }));

    expect(switchOrgMutate).not.toHaveBeenCalled();
  });
});
