import { LinkIcon, RobotIcon, UserIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Input,
  ToggleGroup,
  ToggleGroupItem,
} from "@posthog/quill";
import { DemoMessageItem } from "@posthog/ui/features/canvas/components/ChannelFeedView";
import { MentionComposer } from "@posthog/ui/features/canvas/components/MentionComposer";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useDashboards } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import { useDemoFeedStore } from "@posthog/ui/features/canvas/stores/demoFeedStore";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { toast } from "@posthog/ui/primitives/toast";
import { useThemeStore } from "@posthog/ui/shell/themeStore";
import { Theme } from "@radix-ui/themes";
import { useState } from "react";

// Agent messages read as "PostHog", matching the real agent feed rows.
const AGENT_PERSONA = "PostHog";

// Dev-only composer for "fake" channel messages (demos). Persists locally (the
// feed POST endpoint isn't deployed everywhere) and shows in the channel feed on
// this machine. Lets you pick who it's from (a person, or the "PostHog" agent),
// @-mention teammates like a thread, and drop in canvas / context references,
// with a live thread-item preview of the result.
export function InsertFakeMessageDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { channels } = useChannels();
  const channelName = channels.find((c) => c.id === channelId)?.name;
  const { dashboards } = useDashboards(channelId);
  const { members } = useOrgMembers();
  const addDemoMessage = useDemoFeedStore((s) => s.add);
  // The dialog portals to <body>, outside the app's Radix <Theme> — re-establish
  // it so the Radix-Themes bits inside (the mention popup, MentionText preview)
  // get their scoped styles back instead of rendering unstyled.
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  const [fromName, setFromName] = useState("");
  const [fromKind, setFromKind] = useState<"human" | "agent">("human");
  const [content, setContent] = useState("");

  // Reset fields on each open so a prior draft never lingers (prev-prop compare,
  // not an effect, so there's no stale flash).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFromName("");
      setFromKind("human");
      setContent("");
    }
  }

  // Switching to the agent persona locks the name to "PostHog" (matching the
  // real agent feed rows); switching back clears that persona so a human name
  // can be typed.
  const selectKind = (next: "human" | "agent") => {
    setFromKind(next);
    if (next === "agent") setFromName(AGENT_PERSONA);
    else if (fromName === AGENT_PERSONA) setFromName("");
  };

  // Append a reference to an internal item as a deep link: `[label](/route)`.
  // The feed renders messages with the thread renderer (MentionText), which
  // turns an in-app route into a click-to-navigate link (opening that canvas /
  // context in-app).
  const insertReference = (label: string, href: string) => {
    setContent(
      (c) => `${c}${c && !c.endsWith(" ") ? " " : ""}[${label}](${href})`,
    );
  };

  const canSubmit = !!content.trim();

  const submit = () => {
    if (!canSubmit) return;
    addDemoMessage(channelId, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      fromName:
        fromKind === "agent" ? AGENT_PERSONA : fromName.trim() || "Someone",
      fromKind,
      content: content.trim(),
    });
    toast.success("Added to the channel feed");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold">Insert fake message</DialogTitle>
          <DialogDescription>
            Dev-only: drops a fake message into #{channelName ?? "channel"}'s
            feed on this machine. For demos.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Theme
            appearance={isDarkMode ? "dark" : "light"}
            accentColor={isDarkMode ? "yellow" : "orange"}
            grayColor="slate"
            panelBackground="solid"
            radius="medium"
            hasBackground={false}
            className="flex flex-col gap-4"
          >
            {/* From: persona name + human/agent, with member quick-picks. */}
            <Field>
              <FieldLabel htmlFor="fake-from">From</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="fake-from"
                  value={fromName}
                  placeholder="Who it's from — e.g. Ann"
                  disabled={fromKind === "agent"}
                  onChange={(e) => setFromName(e.target.value)}
                  className="flex-1"
                />
                <ToggleGroup
                  value={[fromKind]}
                  onValueChange={(v) => {
                    const next = v[0];
                    if (next === "human" || next === "agent") selectKind(next);
                  }}
                >
                  <ToggleGroupItem value="human" aria-label="From a person">
                    <UserIcon size={14} />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="agent" aria-label="From the agent">
                    <RobotIcon size={14} />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {members.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {members.slice(0, 8).map((m) => (
                    <Button
                      key={m.uuid}
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setFromName(userDisplayName(m));
                        setFromKind("human");
                      }}
                    >
                      {userDisplayName(m)}
                    </Button>
                  ))}
                </div>
              )}
            </Field>

            {/* Message body: a real thread composer, so @ opens the same member
              picker as a thread. The reference menu drops in canvas / context
              names as text. */}
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Message</FieldLabel>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="xs">
                        <LinkIcon size={13} />
                        Insert reference
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="max-h-72 w-56">
                    {dashboards.length > 0 && (
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Canvases</DropdownMenuLabel>
                        {dashboards.map((d) => (
                          <DropdownMenuItem
                            key={d.id}
                            onClick={() =>
                              insertReference(
                                d.name,
                                `/website/${channelId}/dashboards/${d.id}`,
                              )
                            }
                          >
                            {d.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    )}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Contexts</DropdownMenuLabel>
                      {channels.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          onClick={() =>
                            insertReference(`#${c.name}`, `/website/${c.id}`)
                          }
                        >
                          #{c.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="rounded-md border border-border px-2 py-1">
                <MentionComposer
                  value={content}
                  onValueChange={setContent}
                  onSubmit={submit}
                  members={members}
                  placeholder="Write a message… @ to mention someone"
                  rows={4}
                  inputClassName="text-[13px]"
                />
              </div>
            </Field>

            {/* Live preview of the thread item that will land in the feed. */}
            <div>
              <FieldLabel>Preview</FieldLabel>
              <div className="mt-1 rounded-md border border-border bg-gray-1 px-2">
                <DemoMessageItem
                  fromName={fromName}
                  fromKind={fromKind}
                  content={content}
                />
              </div>
            </div>
          </Theme>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            Add to feed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
