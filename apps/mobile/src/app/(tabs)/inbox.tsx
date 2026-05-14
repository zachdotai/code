import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilterSheet } from "@/features/inbox/components/FilterSheet";
import { FloatingInboxHeader } from "@/features/inbox/components/FloatingInboxHeader";
import { ReportList } from "@/features/inbox/components/ReportList";
import { ReviewerFilterSheet } from "@/features/inbox/components/ReviewerFilterSheet";
import { useInboxReports } from "@/features/inbox/hooks/useInboxReports";
import { useInboxFilterStore } from "@/features/inbox/stores/inboxFilterStore";
import type { SignalReport } from "@/features/inbox/types";

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isFetching, error } = useInboxReports();
  const [filterOpen, setFilterOpen] = useState(false);
  const [reviewerOpen, setReviewerOpen] = useState(false);
  const reviewerFilterCount = useInboxFilterStore(
    (s) => s.suggestedReviewerFilter.length,
  );

  const handleReportPress = useCallback(
    (report: SignalReport) => {
      router.push(`/report/${report.id}`);
    },
    [router],
  );

  // Header occupies insets.top + 6 (top pad) + 40 (MenuButton) + 8 (bottom
  // pad), plus a small buffer so the first row isn't hugging the fade edge.
  const headerHeight = insets.top + 60;

  return (
    <View className="flex-1 bg-background">
      <ReportList
        onReportPress={handleReportPress}
        contentInsetTop={headerHeight}
      />

      <FloatingInboxHeader
        isFetching={isFetching}
        hasError={!!error}
        reviewerFilterCount={reviewerFilterCount}
        onReviewerPress={() => setReviewerOpen(true)}
        onFilterPress={() => setFilterOpen(true)}
      />

      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} />
      <ReviewerFilterSheet
        visible={reviewerOpen}
        onClose={() => setReviewerOpen(false)}
      />
    </View>
  );
}
