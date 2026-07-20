/** Validation and canonical application of model-step edit scripts. @internal */

import type { AssistantContentPart } from "../types/content";
import { isPolicyTerminal, SafetyResultError } from "../safety/errors";
import type {
  ExecutorModelStep,
  StepContentEdit,
  StepTransformer,
} from "./executor-types";

/** Await one transformer and apply its edits, preserving terminal failures. */
export async function transformCanonicalStep(
  transformer: StepTransformer,
  step: ExecutorModelStep,
): Promise<readonly AssistantContentPart[]> {
  try {
    return applyCanonicalStepEdits(
      step.content,
      await transformer.transform(step),
    );
  } catch (error) {
    if (isPolicyTerminal(error)) throw error;
    throw contractError(
      "The step transformer failed before client-tool execution.",
    );
  }
}

/**
 * Apply strictly ordered Core-produced edits to canonical assistant content.
 *
 * Unedited parts retain identity. Invalid indexes, duplicate/out-of-order
 * edits, cross-kind edits, and tool-call edits fail closed before client tools.
 */
export function applyCanonicalStepEdits(
  content: readonly AssistantContentPart[],
  edits: readonly StepContentEdit[],
): readonly AssistantContentPart[] {
  const byIndex = new Map<number, StepContentEdit>();
  let previous = -1;
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.partIndex) ||
      edit.partIndex <= previous ||
      edit.partIndex >= content.length
    ) {
      throw contractError(
        "Edits must use unique, strictly increasing canonical part indexes.",
      );
    }
    previous = edit.partIndex;
    byIndex.set(edit.partIndex, edit);
  }

  const transformed: AssistantContentPart[] = [];
  for (const [partIndex, part] of content.entries()) {
    const edit = byIndex.get(partIndex);
    if (!edit) {
      transformed.push(part);
      continue;
    }
    if (edit.kind === "replace-text") {
      if (part.type !== "text" && part.type !== "reasoning") {
        throw contractError(
          "Replace-text edits may target only text or reasoning parts.",
        );
      }
      transformed.push(Object.freeze({ ...part, text: edit.text }));
      continue;
    }
    if (
      part.type === "text" ||
      part.type === "reasoning" ||
      part.type === "tool-call"
    ) {
      throw contractError(
        "Remove edits may target only media parts; tool-call parts are immutable.",
      );
    }
  }
  return Object.freeze(transformed);
}

function contractError(problem: string): SafetyResultError {
  return new SafetyResultError({
    message: `Invalid model-step transform: ${problem}`,
    policyId: "step-transform",
    boundary: "model.output",
    problem,
  });
}
