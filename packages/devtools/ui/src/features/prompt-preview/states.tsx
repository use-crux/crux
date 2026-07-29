import type { PromptPreviewWorkflowState } from "./types";

export function PromptPreviewState({
  state,
}: {
  readonly state: PromptPreviewWorkflowState;
}) {
  if (state.phase === "unavailable" || state.phase === "error") {
    return <p>{state.message}</p>;
  }
  if (state.phase === "ready") return <p>Exact preview ready.</p>;
  if (state.phase === "running") return <p>Running exact preview…</p>;
  return <p>Exact Prompt preview</p>;
}
