import { Text } from "@components/text";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import { GlassContainer, GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Lightning, Play, Warning } from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MarkdownText } from "@/features/chat/components/MarkdownText";
import { getReportRepository } from "@/features/inbox/api";
import { useInboxReport } from "@/features/inbox/hooks/useInboxReports";
import type {
  SignalReportPriority,
  SignalReportStatus,
} from "@/features/inbox/types";
import { inboxStatusLabel } from "@/features/inbox/utils";
import { useThemeColors } from "@/lib/theme";

const statusColorMap: Record<string, { bg: string; text: string }> = {
  ready: { bg: "bg-status-success/20", text: "text-status-success" },
  pending_input: { bg: "bg-accent-3", text: "text-accent-11" },
  in_progress: { bg: "bg-status-warning/20", text: "text-status-warning" },
  candidate: { bg: "bg-status-info/20", text: "text-status-info" },
  potential: { bg: "bg-gray-5/20", text: "text-gray-9" },
  failed: { bg: "bg-status-error/20", text: "text-status-error" },
  suppressed: { bg: "bg-gray-5/20", text: "text-gray-9" },
  deleted: { bg: "bg-gray-5/20", text: "text-gray-9" },
};

const priorityColorMap: Record<string, { bg: string; text: string }> = {
  P0: { bg: "bg-status-error/20", text: "text-status-error" },
  P1: { bg: "bg-status-warning/20", text: "text-status-warning" },
  P2: { bg: "bg-status-warning/20", text: "text-status-warning" },
  P3: { bg: "bg-gray-5/20", text: "text-gray-9" },
  P4: { bg: "bg-gray-5/20", text: "text-gray-9" },
};

function StatusBadge({ status }: { status: SignalReportStatus }) {
  const colors = statusColorMap[status] ?? statusColorMap.potential;
  return (
    <View className={`rounded px-2 py-1 ${colors.bg}`}>
      <Text className={`font-medium text-[12px] ${colors.text}`}>
        {inboxStatusLabel(status)}
      </Text>
    </View>
  );
}

function PriorityBadge({ priority }: { priority: SignalReportPriority }) {
  const colors = priorityColorMap[priority] ?? priorityColorMap.P3;
  return (
    <View className={`rounded px-2 py-1 ${colors.bg}`}>
      <Text className={`font-medium text-[12px] ${colors.text}`}>
        {priority}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="mb-1.5 font-semibold text-[13px] text-gray-10 uppercase tracking-wide">
      {title}
    </Text>
  );
}

export default function ReportDetailScreen() {
  const { id: reportId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { data: report, isLoading, error } = useInboxReport(reportId ?? null);
  const [reportRepo, setReportRepo] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    let cancelled = false;
    getReportRepository(reportId)
      .then((repo) => {
        if (!cancelled) setReportRepo(repo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const handleStartTask = useCallback(() => {
    if (!report) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const prompt = `Act on this signal report. Investigate the root cause, implement the fix, and open a PR if appropriate.\n\n${report.summary ?? ""}`;
    router.push({
      pathname: "/task",
      params: {
        prompt,
        ...(reportRepo ? { repo: reportRepo } : {}),
        signalReport: report.id,
      },
    });
  }, [report, router, reportRepo]);

  if (error) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Error",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background px-4">
          <Text className="mb-4 text-center text-status-error">
            Failed to load report
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="rounded-lg bg-gray-3 px-4 py-2"
          >
            <Text className="text-gray-12">Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (isLoading || !report) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Loading...",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background">
          <ActivityIndicator size="large" color={themeColors.accent[9]} />
        </View>
      </>
    );
  }

  const updatedAt = new Date(report.updated_at);
  const hoursSince = differenceInHours(new Date(), updatedAt);
  const timeDisplay =
    hoursSince < 24
      ? formatDistanceToNow(updatedAt, { addSuffix: true })
      : format(updatedAt, "MMM d, yyyy");

  const isReady = report.status === "ready";

  const isAwaitingInput =
    report.status === "pending_input" ||
    (report.status === "ready" &&
      report.actionability === "requires_human_input");

  const canStartTask =
    isAwaitingInput ||
    (report.status === "ready" &&
      report.actionability === "immediately_actionable" &&
      report.already_addressed !== true);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: report.title ?? "Untitled signal",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          headerTitleStyle: { fontWeight: "600" },
          presentation: "modal",
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 100,
        }}
      >
        {/* Badges row */}
        <View className="mb-3 flex-row flex-wrap items-center gap-1.5">
          <StatusBadge status={report.status} />
          {report.priority && <PriorityBadge priority={report.priority} />}
          {report.is_suggested_reviewer && (
            <View className="rounded bg-status-warning/20 px-2 py-1">
              <Text className="font-medium text-[12px] text-status-warning">
                For you
              </Text>
            </View>
          )}
          {report.already_addressed && (
            <View className="rounded bg-status-warning/20 px-2 py-1">
              <Text className="font-medium text-[12px] text-status-warning">
                May be addressed
              </Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text className="mb-2 font-semibold text-[18px] text-gray-12">
          {report.title ?? "Untitled signal"}
        </Text>

        {/* Meta row */}
        <View className="mb-4 flex-row items-center gap-3">
          <View className="flex-row items-center gap-1">
            <Lightning size={13} color={themeColors.gray[9]} />
            <Text className="text-[12px] text-gray-9">
              {report.signal_count} signal{report.signal_count !== 1 ? "s" : ""}
            </Text>
          </View>
          <Text className="text-[12px] text-gray-9">Updated {timeDisplay}</Text>
        </View>

        {/* Failed warning */}
        {report.status === "failed" && (
          <View className="mb-4 flex-row items-start gap-2 rounded-lg bg-status-error/10 p-3">
            <Warning size={16} color={themeColors.status.error} weight="fill" />
            <View className="flex-1">
              <Text className="font-medium text-[13px] text-status-error">
                Report processing failed
              </Text>
              <Text className="mt-0.5 text-[12px] text-status-error">
                There was an issue processing this report. It may be retried
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Summary */}
        {report.summary && (
          <View className="mb-4" style={{ opacity: isReady ? 1 : 0.7 }}>
            <MarkdownText content={report.summary} />
          </View>
        )}

        {/* Actionability info */}
        {report.actionability && (
          <View className="mb-4">
            <SectionHeader title="Actionability" />
            <View className="rounded-lg bg-gray-2 p-3">
              <Text className="text-[13px] text-gray-12">
                {report.actionability === "immediately_actionable"
                  ? "This report is immediately actionable — a task can be created directly."
                  : report.actionability === "requires_human_input"
                    ? "This report needs human input before it can be acted on."
                    : "This report is not directly actionable at this time."}
              </Text>
            </View>
          </View>
        )}

        {/* PR link */}
        {report.implementation_pr_url && (
          <View className="mb-4">
            <SectionHeader title="Implementation" />
            <View className="rounded-lg bg-gray-2 p-3">
              <Text className="text-[13px] text-accent-11" numberOfLines={1}>
                {report.implementation_pr_url}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating "Start task" button */}
      {canStartTask && (
        <View
          className="absolute inset-x-0 items-center"
          style={{ bottom: insets.bottom + 16 }}
          pointerEvents="box-none"
        >
          {Platform.OS === "ios" ? (
            <GlassContainer spacing={0} style={{ borderRadius: 28 }}>
              <Pressable
                onPress={handleStartTask}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <GlassView
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 24,
                    paddingVertical: 14,
                    borderRadius: 28,
                  }}
                  isInteractive
                >
                  <Play size={18} color={themeColors.accent[9]} weight="fill" />
                  <Text className="font-semibold text-[15px] text-gray-12">
                    Start task
                  </Text>
                </GlassView>
              </Pressable>
            </GlassContainer>
          ) : (
            <Pressable
              onPress={handleStartTask}
              className="elevation-4 flex-row items-center gap-2 rounded-full border border-gray-6 bg-gray-2 px-6 py-3.5 shadow-lg active:opacity-80"
            >
              <Play size={18} color={themeColors.accent[9]} weight="fill" />
              <Text className="font-semibold text-[15px] text-gray-12">
                Start task
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}
