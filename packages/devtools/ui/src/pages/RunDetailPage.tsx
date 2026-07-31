import { RunDetailShell } from "@/features/run-detail/components/RunDetailShell";
import type { RunLens } from "@/features/run-detail/types";
import type { EvidenceRole } from "@use-crux/core/evidence";

interface RunDetailPageProps {
  traceId: string;
  lens?: RunLens;
  spanId?: string;
  summary?: boolean;
  detailTab?: "evidence";
  evidenceRole?: EvidenceRole;
  evidenceId?: string;
}

export function RunDetailPage(props: RunDetailPageProps) {
  return <RunDetailShell {...props} />;
}
