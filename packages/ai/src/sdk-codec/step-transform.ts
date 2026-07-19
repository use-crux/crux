/** AI SDK native/canonical model-step transformation. @internal */

import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3,
} from "@ai-sdk/provider";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import type { StepContentEdit, StepTransformer } from "@use-crux/core/adapter";
import { isPolicyTerminal, SafetyResultError } from "@use-crux/core/safety";
import { projectAssistantContentFromAiSdkParts } from "../assistant-content";

const stepIndexes = new WeakMap<StepTransformer, number>();

/** Create a per-loop wrapper for each AI SDK-resolved concrete step model. */
export function createStepTransformModelWrapper(
  transformer: StepTransformer,
): (model: LanguageModelV3) => LanguageModelV3 {
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) =>
      transformGenerateResult(
        await doGenerate(),
        takeStepIndex(transformer),
        transformer,
      ),
  };
  return (model) => wrapLanguageModel({ model, middleware });
}

function takeStepIndex(transformer: StepTransformer): number {
  const index = stepIndexes.get(transformer) ?? 0;
  stepIndexes.set(transformer, index + 1);
  return index;
}

async function transformGenerateResult(
  result: LanguageModelV3GenerateResult,
  stepIndex: number,
  transformer: StepTransformer,
): Promise<LanguageModelV3GenerateResult> {
  const native = result.content as unknown as readonly Record<
    string,
    unknown
  >[];
  const projection = projectAssistantContentFromAiSdkParts(native);
  const edits = await runTransformer(transformer, {
    index: stepIndex,
    content: projection.content,
  });
  if (edits.length === 0) return result;
  return {
    ...result,
    content: applyNativeEdits(
      result.content,
      projection.nativeIndexes,
      projection.content,
      edits,
    ),
  };
}

function applyNativeEdits(
  nativeContent: readonly LanguageModelV3Content[],
  nativeIndexes: readonly number[],
  canonicalContent: ReturnType<
    typeof projectAssistantContentFromAiSdkParts
  >["content"],
  edits: readonly StepContentEdit[],
): LanguageModelV3Content[] {
  const nativeEdits = new Map<number, StepContentEdit>();
  let previous = -1;
  for (const edit of edits) {
    const canonical = canonicalContent[edit.partIndex];
    const nativeIndex = nativeIndexes[edit.partIndex];
    if (
      !Number.isInteger(edit.partIndex) ||
      edit.partIndex <= previous ||
      canonical === undefined ||
      nativeIndex === undefined ||
      nativeEdits.has(nativeIndex)
    ) {
      throw contractError(
        "Edits must use unique, strictly increasing canonical part indexes.",
      );
    }
    previous = edit.partIndex;
    validateEditTarget(canonical.type, edit);
    nativeEdits.set(nativeIndex, edit);
  }

  const transformed: LanguageModelV3Content[] = [];
  for (const [nativeIndex, part] of nativeContent.entries()) {
    const edit = nativeEdits.get(nativeIndex);
    if (!edit) {
      transformed.push(part);
    } else if (edit.kind === "replace-text") {
      if (part.type !== "text" && part.type !== "reasoning") {
        throw contractError(
          "A canonical text edit did not map to native text or reasoning content.",
        );
      }
      transformed.push({ ...part, text: edit.text });
    }
  }
  return transformed;
}

function validateEditTarget(
  type: ReturnType<
    typeof projectAssistantContentFromAiSdkParts
  >["content"][number]["type"],
  edit: StepContentEdit,
): void {
  if (edit.kind === "replace-text" && type !== "text" && type !== "reasoning") {
    throw contractError(
      "Replace-text edits may target only text or reasoning parts.",
    );
  }
  if (
    edit.kind === "remove" &&
    (type === "text" || type === "reasoning" || type === "tool-call")
  ) {
    throw contractError(
      "Remove edits may target only media parts; tool-call parts are immutable.",
    );
  }
}

async function runTransformer(
  transformer: StepTransformer,
  step: Parameters<StepTransformer["transform"]>[0],
): Promise<readonly StepContentEdit[]> {
  try {
    return await transformer.transform(step);
  } catch (error) {
    if (isPolicyTerminal(error)) throw error;
    throw contractError(
      "The step transformer failed before client-tool execution.",
    );
  }
}

function contractError(problem: string): SafetyResultError {
  return new SafetyResultError({
    message: `Invalid model-step transform: ${problem}`,
    policyId: "step-transform",
    boundary: "model.output",
    problem,
  });
}
