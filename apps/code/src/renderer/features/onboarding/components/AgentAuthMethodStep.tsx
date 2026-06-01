import { ArrowLeft, ArrowRight, Check } from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { StepActions } from "./StepActions";

type AuthChoice = "posthog" | "subscription";

interface AgentAuthMethodStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function AgentAuthMethodStep({
  onNext,
  onBack,
}: AgentAuthMethodStepProps) {
  const trpcReact = useTRPC();
  const queryClient = useQueryClient();

  const { data: claudeEnabled } = useQuery(
    trpcReact.claudeSubscription.getEnabled.queryOptions(),
  );
  const { data: claudeStatus, refetch: refetchClaudeStatus } = useQuery(
    trpcReact.claudeSubscription.getStatus.queryOptions(),
  );
  const { data: codexEnabled } = useQuery(
    trpcReact.codexSubscription.getEnabled.queryOptions(),
  );
  const { data: codexStatus, refetch: refetchCodexStatus } = useQuery(
    trpcReact.codexSubscription.getStatus.queryOptions(),
  );

  const setClaudeEnabled = useMutation(
    trpcReact.claudeSubscription.setEnabled.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpcReact.claudeSubscription.getEnabled.queryKey(),
        });
      },
    }),
  );
  const setCodexEnabled = useMutation(
    trpcReact.codexSubscription.setEnabled.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpcReact.codexSubscription.getEnabled.queryKey(),
        });
      },
    }),
  );

  const [claudeChoice, setClaudeChoice] = useState<AuthChoice>(
    claudeEnabled ? "subscription" : "posthog",
  );
  const [codexChoice, setCodexChoice] = useState<AuthChoice>(
    codexEnabled ? "subscription" : "posthog",
  );

  const claudeSignedIn = claudeStatus?.signedIn ?? false;
  const codexSignedIn = codexStatus?.signedIn ?? false;

  // Block continuing while an agent is set to its own subscription but not yet
  // signed in — otherwise that agent would have no working credentials.
  const blockedBySignIn =
    (claudeChoice === "subscription" && !claudeSignedIn) ||
    (codexChoice === "subscription" && !codexSignedIn);

  const handleContinue = async () => {
    if (blockedBySignIn) {
      await Promise.all([refetchClaudeStatus(), refetchCodexStatus()]);
      return;
    }
    await Promise.all([
      setClaudeEnabled.mutateAsync({
        enabled: claudeChoice === "subscription",
      }),
      setCodexEnabled.mutateAsync({ enabled: codexChoice === "subscription" }),
    ]);
    onNext();
  };

  return (
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex
          direction="column"
          className="min-h-0 w-full flex-1 overflow-y-auto"
        >
          <Flex
            direction="column"
            gap="5"
            style={{ margin: "auto auto" }}
            className="w-full max-w-[720px] px-0 py-[16px]"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Flex direction="column" gap="3">
                <Text className="font-bold text-(--gray-12) text-2xl">
                  How should we power your coding agents?
                </Text>
                <Text className="text-(--gray-11) text-sm">
                  Choose whether to use PostHog's managed access or your own
                  subscription for each agent. You can change this later in
                  Settings.
                </Text>
              </Flex>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
            >
              <AgentAuthSection
                agentName="Claude"
                subscriptionLabel="My Claude subscription"
                subscriptionDescription="Use your existing Claude Max or Pro subscription. Bypasses PostHog billing for LLM calls."
                signInCommand="claude auth login"
                choice={claudeChoice}
                onChoice={setClaudeChoice}
                signedIn={claudeSignedIn}
                accountEmail={claudeStatus?.accountEmail ?? null}
                onRefresh={() => void refetchClaudeStatus()}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <AgentAuthSection
                agentName="Codex"
                subscriptionLabel="My Codex subscription"
                subscriptionDescription="Use your existing OpenAI/ChatGPT subscription. Bypasses PostHog billing for LLM calls."
                signInCommand="codex login"
                choice={codexChoice}
                onChoice={setCodexChoice}
                signedIn={codexSignedIn}
                accountEmail={codexStatus?.accountEmail ?? null}
                onRefresh={() => void refetchCodexStatus()}
              />
            </motion.div>
          </Flex>
        </Flex>

        <StepActions delay={0.25}>
          <Button size="3" variant="outline" color="gray" onClick={onBack}>
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          <Button
            size="3"
            onClick={() => void handleContinue()}
            disabled={blockedBySignIn}
          >
            Continue
            <ArrowRight size={16} weight="bold" />
          </Button>
        </StepActions>
      </Flex>
    </Flex>
  );
}

interface AgentAuthSectionProps {
  agentName: string;
  subscriptionLabel: string;
  subscriptionDescription: string;
  signInCommand: string;
  choice: AuthChoice;
  onChoice: (choice: AuthChoice) => void;
  signedIn: boolean;
  accountEmail: string | null;
  onRefresh: () => void;
}

function AgentAuthSection({
  agentName,
  subscriptionLabel,
  subscriptionDescription,
  signInCommand,
  choice,
  onChoice,
  signedIn,
  accountEmail,
  onRefresh,
}: AgentAuthSectionProps) {
  return (
    <Flex direction="column" gap="3">
      <Text className="font-medium text-(--gray-12) text-sm">{agentName}</Text>
      <Flex gap="3" align="stretch">
        <AuthChoiceCard
          title="PostHog credits"
          description={`Use your PostHog plan to power ${agentName}. Easiest setup; usage counts against your PostHog plan.`}
          selected={choice === "posthog"}
          onSelect={() => onChoice("posthog")}
          recommended
        />
        <AuthChoiceCard
          title={subscriptionLabel}
          description={subscriptionDescription}
          selected={choice === "subscription"}
          onSelect={() => onChoice("subscription")}
        />
      </Flex>

      {choice === "subscription" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Flex
            direction="column"
            gap="2"
            p="4"
            className="rounded-(--radius-3) border border-(--gray-5)"
          >
            {signedIn ? (
              <Text className="text-sm">
                Signed in to {agentName}
                {accountEmail ? ` as ${accountEmail}` : ""}.
              </Text>
            ) : (
              <>
                <Text className="font-medium text-sm">
                  Sign in to {agentName}
                </Text>
                <Text color="gray" className="text-[13px]">
                  Run the following in your terminal, then click Refresh:
                </Text>
                <Text className="rounded-(--radius-2) bg-(--gray-3) p-2 font-mono text-[12px]">
                  {signInCommand}
                </Text>
                <Button
                  size="1"
                  variant="outline"
                  onClick={onRefresh}
                  className="self-start"
                >
                  Refresh
                </Button>
              </>
            )}
          </Flex>
        </motion.div>
      )}
    </Flex>
  );
}

interface AuthChoiceCardProps {
  title: string;
  description: string;
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}

function AuthChoiceCard({
  title,
  description,
  selected,
  recommended,
  onSelect,
}: AuthChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-1 cursor-pointer flex-col justify-start rounded-(--radius-3) border p-4 text-left ${
        selected
          ? "border-(--accent-7) bg-(--accent-2)"
          : "border-(--gray-5) bg-transparent"
      }`}
    >
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between">
          <Text className="font-medium text-(--gray-12) text-sm">{title}</Text>
          {selected && (
            <Check size={16} weight="bold" className="text-(--accent-9)" />
          )}
        </Flex>
        {recommended && (
          <Text
            className="font-medium text-(--accent-9) text-[11px]"
            style={{ letterSpacing: "0.05em" }}
          >
            RECOMMENDED
          </Text>
        )}
        <Text className="text-(--gray-11) text-[13px]">{description}</Text>
      </Flex>
    </button>
  );
}
