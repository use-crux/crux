import { promptPreviewInputFits } from "./input-policy";
import type {
  PromptPreviewChoice,
  PromptPreviewDiscovery,
  PromptPreviewWorkflowState,
} from "./types";

/** Build one immutable input state from current discovery and raw input. */
export function promptPreviewInputState(
  definitionId: string,
  rawText: string,
  input: Readonly<Record<string, unknown>> | undefined,
  discovery: Extract<PromptPreviewDiscovery, { status: "ready" }>,
  selected: PromptPreviewChoice | undefined,
  result?: PromptPreviewWorkflowState["result"],
): PromptPreviewWorkflowState {
  return {
    phase: "input",
    rawText,
    canPreview:
      input !== undefined &&
      selected !== undefined &&
      promptPreviewInputFits(definitionId, selected, input),
    discovery,
    selected,
    result,
  };
}

/** Resolve a retained tuple only when every immutable identity field matches. */
export function matchingPromptPreviewChoice(
  discovery: Extract<PromptPreviewDiscovery, { status: "ready" }>,
  candidate: PromptPreviewChoice | undefined,
): PromptPreviewChoice | undefined {
  return candidate
    ? discovery.choices.find((choice) => sameChoice(choice, candidate))
    : undefined;
}

function sameChoice(
  left: PromptPreviewChoice | undefined,
  right: PromptPreviewChoice | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.peerId === right.peerId &&
    left.environment === right.environment &&
    left.catalogueRevision === right.catalogueRevision
  );
}
