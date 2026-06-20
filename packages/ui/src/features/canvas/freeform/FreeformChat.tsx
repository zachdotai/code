import { PaperPlaneRightIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@posthog/quill";
import { ContextEditor } from "@posthog/ui/features/canvas/freeform/ContextEditor";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import {
  useFreeformChatStore,
  useFreeformThread,
} from "@posthog/ui/features/canvas/stores/freeformChatStore";
import { Box, Flex, ScrollArea, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

// Chat panel for a freeform (React-in-iframe) canvas. Mirrors CanvasChat but is
// bound to the freeform store (which streams code, not a json-render spec). Two
// tabs: Chat (the agent conversation) and Context (an author-written markdown
// note passed to the agent on every turn; edits snapshot a version + autosave).
export function FreeformChat({ threadId }: { threadId: string }) {
  const { messages, isStreaming, lastTool, error, code, context, templateId } =
    useFreeformThread(threadId);
  const send = useFreeformChatStore((s) => s.send);
  const setContext = useFreeformChatStore((s) => s.setContext);
  const commitContext = useFreeformChatStore((s) => s.commitContext);
  const templates = useCanvasTemplates();
  const suggestions = code
    ? []
    : (templates.find((t) => t.id === (templateId ?? "freeform"))
        ?.suggestions ??
      templates.find((t) => t.id === "freeform")?.suggestions ??
      []);

  const [tab, setTab] = useState("chat");
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fillSuggestion = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, lastTool]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    void send(threadId, text);
  };

  // Leaving the Context tab is a natural commit point (snapshot a version +
  // autosave), in addition to the editor's own blur handler.
  const onTabChange = (next: string) => {
    if (tab === "context" && next !== "context") commitContext(threadId);
    setTab(next);
  };

  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      className="flex h-full shrink-0 flex-col border-gray-6 border-l bg-gray-2"
      style={{ width: 360, minWidth: 360 }}
    >
      <Box className="shrink-0 border-gray-6 border-b px-2 py-1.5">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
        </TabsList>
      </Box>

      <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
        <ScrollArea ref={threadRef} className="flex-1">
          <Flex direction="column" gap="3" p="3">
            {messages.length === 0 && (
              <Flex direction="column" gap="3">
                <Text size="1" className="text-gray-10">
                  Describe the app you want. The agent writes a React app that
                  runs in a sandbox and can read your PostHog data.
                </Text>
                {suggestions.length > 0 && draft.trim().length === 0 && (
                  <Flex direction="column" align="start" gap="1">
                    {suggestions.map((suggestion) => (
                      <Button
                        key={suggestion.label}
                        variant="outline"
                        size="sm"
                        className="max-w-full justify-start text-left"
                        onClick={() => fillSuggestion(suggestion.prompt)}
                      >
                        {suggestion.label}
                      </Button>
                    ))}
                  </Flex>
                )}
              </Flex>
            )}
            {messages.map((message) => (
              <Flex
                key={message.id}
                direction="column"
                className={
                  message.role === "user"
                    ? "self-end rounded-lg bg-accent-4 px-3 py-2"
                    : "self-start"
                }
                style={{ maxWidth: "90%" }}
              >
                {message.text ? (
                  <Text
                    size="1"
                    className={
                      message.role === "user"
                        ? "text-accent-12"
                        : "text-gray-11"
                    }
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {message.text}
                  </Text>
                ) : (
                  message.role === "assistant" &&
                  isStreaming && (
                    <Text size="1" className="text-gray-9">
                      Thinking…
                    </Text>
                  )
                )}
              </Flex>
            ))}
            {lastTool && (
              <Flex align="center" gap="1" className="text-gray-9">
                <SpinnerGapIcon size={12} className="animate-spin" />
                <Text size="1">{lastTool}</Text>
              </Flex>
            )}
            {error && (
              <Text size="1" className="text-red-11">
                {error}
              </Text>
            )}
          </Flex>
        </ScrollArea>

        <Box className="shrink-0 border-gray-6 border-t p-2">
          <Flex gap="2" align="end">
            <TextArea
              ref={inputRef}
              className="flex-1"
              placeholder="Build an app that…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
            />
            <Button
              size="icon"
              variant="primary"
              aria-label="Send"
              disabled={isStreaming || draft.trim().length === 0}
              onClick={submit}
            >
              {isStreaming ? (
                <SpinnerGapIcon size={16} className="animate-spin" />
              ) : (
                <PaperPlaneRightIcon size={16} />
              )}
            </Button>
          </Flex>
        </Box>
      </TabsContent>

      <TabsContent value="context" className="flex min-h-0 flex-1 flex-col">
        <Box className="shrink-0 px-3 py-2">
          <Text size="1" className="text-gray-10">
            Notes and requirements for this canvas. The agent reads this on
            every build. Edits are saved as a version.
          </Text>
        </Box>
        <Box className="min-h-0 flex-1">
          <ContextEditor
            value={context}
            onChange={(next) => setContext(threadId, next)}
            onCommit={() => commitContext(threadId)}
          />
        </Box>
      </TabsContent>
    </Tabs>
  );
}
