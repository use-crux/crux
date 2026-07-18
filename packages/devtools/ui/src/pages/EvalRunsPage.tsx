import { EvalRunsView } from "@/features/evals/components/EvalRunsView";
export function EvalRunsPage({ runId }: { runId?: string }) {
  return <EvalRunsView runId={runId} />;
}
