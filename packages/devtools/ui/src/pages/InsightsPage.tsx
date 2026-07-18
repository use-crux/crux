import { InsightsView } from "@/features/insights/components/InsightsView";
import type {
  InsightsFilters,
  InsightsGroupBy,
} from "@/features/insights/components/InsightsView";

interface InsightsPageProps {
  filters: InsightsFilters;
  groupBy: InsightsGroupBy;
}

export function InsightsPage(props: InsightsPageProps) {
  return <InsightsView {...props} />;
}
