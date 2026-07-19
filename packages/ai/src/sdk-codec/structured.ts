import { Output, stepCountIs, type LanguageModel } from "ai";
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
import { sanitizeSchemaForProvider } from "../provider-profile";
import { extractResponse } from "../result-shape";
import { buildBaseArgs } from "./request-args";
import { createStepTransformModelWrapper } from "./step-transform";
import type { AiSdkStructuredPlan, SdkLoopResultLike } from "./types";

type StructuredArgs = Parameters<SdkGateway["generateObject"]>[0];

/**
 * Plan one AI SDK `generateObject()` attempt.
 *
 * Core owns validation retry policy. This codec owns the SDK-specific pieces
 * for a single attempt: provider schema sanitation, cheap JSON text repair,
 * raw result projection, and validation/parse errors returned as values.
 *
 * @internal
 */
export async function createStructuredCallPlan(
  request: StructuredRequest<LanguageModel>,
): Promise<AiSdkStructuredPlan> {
  if (request.stepTransformer) return createGuardedStructuredCallPlan(request);
  const args = await buildStructuredArgs(request);

  return {
    method: "generateObject",
    args,
    decode(raw) {
      const result = raw as SdkLoopResultLike;
      return {
        status: "ok",
        raw: result,
        response: extractResponse(result),
        object: result.object,
      };
    },
    async decodeError(error) {
      if (!isObjectGenerationError(error)) return undefined;
      return {
        status: "invalid",
        rawText: extractRawTextFromError(error),
        error: await extractZodError(error),
      };
    },
  };
}

async function createGuardedStructuredCallPlan(
  request: StructuredRequest<LanguageModel>,
): Promise<AiSdkStructuredPlan> {
  const args = buildBaseArgs(request, { includeTools: false });
  const schema = await sanitizeSchemaForProvider(
    request.schema,
    request.modelInfo,
  );
  const objectOutput = Output.object({ schema: schema as never });
  const wrapStepModel = createStepTransformModelWrapper(
    request.stepTransformer!,
  );
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
  args.prepareStep = ({
    model,
  }: {
    model: Parameters<typeof wrapStepModel>[0];
  }) => ({
    model: wrapStepModel(model),
  });

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
        object: result.output,
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

async function buildStructuredArgs(
  request: StructuredRequest<LanguageModel>,
): Promise<StructuredArgs> {
  const args = buildBaseArgs(request, { includeTools: false });
  args.schema = await sanitizeSchemaForProvider(
    request.schema,
    request.modelInfo,
  );
  args.experimental_repairText = async ({
    text,
  }: {
    readonly text: string;
  }) => {
    const repaired = repairJsonText(text);
    return repaired !== text ? repaired : null;
  };

  return args as StructuredArgs;
}

async function decodeError(error: unknown) {
  if (!isObjectGenerationError(error)) return undefined;
  return {
    status: "invalid" as const,
    rawText: extractRawTextFromError(error),
    error: await extractZodError(error),
  };
}
