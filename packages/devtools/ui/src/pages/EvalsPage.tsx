import { EvalsView } from "@/features/evals/components/EvalsView";
export function EvalsPage({ evalId }: { evalId?: string }) {
  return <EvalsView evalId={evalId} />;
}
