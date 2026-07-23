import { Output, jsonSchema, stepCountIs, type LanguageModel } from "ai";
import { repairJsonText } from "@use-crux/core";
import type {
  AdapterResponse,
  StructuredRequest,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "../gateway";
import {
  extractRawTextFromError,
  extractZodError,
  isObjectGenerationError,
} from "../meta";
import { extractResponse } from "../result-shape";
import { buildBaseArgs } from "./request-args";
import { createStepTransformModelWrapper } from "./step-transform";
import type { AiSdkStructuredPlan, SdkLoopResultLike } from "./types";

/**
 * Plan one AI SDK structured-output attempt.
 *
 * Core owns compilation and validation policy. This codec is a dumb placement
 * layer: it installs the core-compiled wire schema (`request.outputSchema`) as
 * an `Output.object()` on a single-step `generateText()` call — never the
 * authored Zod schema — so the SDK performs only structural validation and the
 * returned `wireValue` is core's to decode and authored-parse.
 *
 * Using `generateText()` + `Output.object()` (rather than the deprecated
 * `generateObject()`) exposes both the completed structured `text` and the
 * parsed wire value, and unifies the guarded (step-transformer) and unguarded
 * paths behind one mechanism.
 *
 * @internal
 */
export async function createStructuredCallPlan(
  request: StructuredRequest<LanguageModel>,
): Promise<AiSdkStructuredPlan> {
  if (!request.outputSchema) {
    throw new Error(
      "Structured generation requires a compiled wire outputSchema; core installs it before transport.",
    );
  }

  const args = buildBaseArgs(request, { includeTools: false });
  const objectOutput = Output.object({
    schema: jsonSchema(request.outputSchema) as never,
  });

  // Cheap JSON repair on the completed structured text, mirrored into the text
  // core treats as authoritative for the wire value.
  let parsedText: string | undefined;
  args.output = {
    ...objectOutput,
    async parseCompleteOutput(
      input: Parameters<typeof objectOutput.parseCompleteOutput>[0],
      context: Parameters<typeof objectOutput.parseCompleteOutput>[1],
    ) {
      try {
        const object = await objectOutput.parseCompleteOutput(input, context);
        parsedText = input.text;
        return object;
      } catch (error) {
        const repaired = repairJsonText(input.text);
        if (repaired === null || repaired === input.text) throw error;
        const object = await objectOutput.parseCompleteOutput(
          { text: repaired },
          context,
        );
        parsedText = repaired;
        return object;
      }
    },
  };
  args.stopWhen = stepCountIs(1);

  if (request.stepTransformer) {
    const wrapStepModel = createStepTransformModelWrapper(
      request.stepTransformer,
    );
    args.prepareStep = ({
      model,
    }: {
      model: Parameters<typeof wrapStepModel>[0];
    }) => ({
      model: wrapStepModel(model),
    });
  }

  return {
    method: "generateText",
    args: args as Parameters<SdkGateway["generateText"]>[0],
    decode(raw) {
      const result = raw as SdkLoopResultLike;
      const response = extractResponse(result);
      const text = parsedText ?? response.text;
      return {
        status: "ok",
        raw: result,
        response:
          text === response.text
            ? response
            : replaceStructuredResponseText(response, text),
        wireValue: result.output,
      };
    },
    decodeError,
  };
}

/** Replace authoritative JSON text without discarding reasoning or media. */
function replaceStructuredResponseText(
  response: AdapterResponse,
  text: string,
): AdapterResponse {
  const content = response.content ?? [{ type: "text" as const, text: response.text }];
  let replaced = false;
  const nextContent = content.map((part) => {
    if (part.type !== "text") return part;
    const replacementText = replaced ? "" : text;
    replaced = true;
    return part.text === replacementText
      ? part
      : { ...part, text: replacementText };
  });
  return {
    ...response,
    text,
    content: replaced ? nextContent : [...nextContent, { type: "text", text }],
  };
}

async function decodeError(error: unknown) {
  if (!isObjectGenerationError(error)) return undefined;
  return {
    status: "invalid" as const,
    rawText: extractRawTextFromError(error),
    error: await extractZodError(error),
  };
}
