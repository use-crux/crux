/** Safe authored facts for one statically recognized media operation. */

import type {
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type { ExtractContext } from "../extensions";
import { mediaOperationNames, nativeMediaExecution } from "./manifest";

/**
 * Project allowlisted operation facts without retaining prompts or media.
 *
 * Text generation is admitted only when syntax proves an input modality.
 */
export function mediaOperationFacts(
  ctx: ExtractContext,
): MediaOperationFacts | undefined {
  const operation = mediaOperationNames.find((name) => name === ctx.match.name);
  if (!operation) return undefined;
  const provenInput = mediaModalities(ctx.config?.json());
  if (
    (operation === "generate" || operation === "stream") &&
    provenInput.length === 0
  ) {
    return undefined;
  }

  const identity = literalIdentity(ctx);
  return {
    kind: "media.operation",
    operation,
    ...operationModalities(operation, provenInput),
    ...identity,
    execution:
      nativeMediaExecution(identity.adapter, operation) ??
      literalExecution(ctx) ??
      "unknown",
    ...authoredOptions(ctx),
  };
}

const mediaModalityOrder = [
  "text",
  "image",
  "audio",
  "video",
  "document",
] as const;

function mediaModalities(value: unknown): readonly ProjectIndexMediaModality[] {
  const found = new Set<ProjectIndexMediaModality>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if ((key === "type" || key === "kind") && typeof nested === "string") {
        const modality = nested === "file" ? "document" : nested;
        if (
          mediaModalityOrder.includes(modality as ProjectIndexMediaModality)
        ) {
          found.add(modality as ProjectIndexMediaModality);
        }
      }
      visit(nested);
    }
  };
  visit(value);
  return mediaModalityOrder.filter((item) => found.has(item));
}

function operationModalities(
  operation: MediaOperationFacts["operation"],
  provenInput: readonly ProjectIndexMediaModality[],
): Pick<MediaOperationFacts, "inputModalities" | "outputModalities"> {
  switch (operation) {
    case "generateImage":
    case "streamImage":
      return { outputModalities: ["image"] };
    case "transcribe":
      return { inputModalities: ["audio"], outputModalities: ["text"] };
    case "generateSpeech":
    case "streamSpeech":
      return { inputModalities: ["text"], outputModalities: ["audio"] };
    case "describe":
      return {
        ...(provenInput.length ? { inputModalities: provenInput } : {}),
        outputModalities: ["text"],
      };
    case "generate":
    case "stream":
      return { inputModalities: provenInput, outputModalities: ["text"] };
  }
}

function literalIdentity(
  ctx: ExtractContext,
): Pick<MediaOperationFacts, "adapter" | "model"> {
  const adapter = adapterForModule(ctx.match.moduleSpecifier);
  const model = ctx.config?.string("model");
  return { ...(adapter ? { adapter } : {}), ...(model ? { model } : {}) };
}

function adapterForModule(
  moduleSpecifier: string | undefined,
): string | undefined {
  switch (moduleSpecifier) {
    case "@use-crux/ai":
      return "ai-sdk";
    case "@use-crux/openai":
      return "openai";
    case "@use-crux/google":
      return "google";
    case "@use-crux/anthropic":
      return "anthropic";
    case "@use-crux/convex":
      return "convex";
    default:
      return undefined;
  }
}

function literalExecution(
  ctx: ExtractContext,
): MediaOperationFacts["execution"] | undefined {
  const value = ctx.config?.string("execution");
  return value === "native" || value === "composed" || value === "unknown"
    ? value
    : undefined;
}

function authoredOptions(
  ctx: ExtractContext,
): Pick<MediaOperationFacts, "authoredOptions"> {
  const config = ctx.config;
  if (!config) return {};
  const options: MediaOperationAuthoredOptions = {
    ...optionalNumber("n", config.number("n")),
    ...optionalString("size", config.string("size")),
    ...optionalString("aspectRatio", config.string("aspectRatio")),
    ...optionalNumber("seed", config.number("seed")),
    ...optionalString("timestamps", config.string("timestamps")),
    ...(config.boolean("diarization") === undefined
      ? {}
      : { diarization: config.boolean("diarization") }),
    ...optionalTranscriptionTask(config),
    ...optionalString("voice", config.string("voice")),
  };
  return Object.keys(options).length ? { authoredOptions: options } : {};
}

function optionalTranscriptionTask(
  config: NonNullable<ExtractContext["config"]>,
): Pick<MediaOperationAuthoredOptions, "task"> {
  const task = config.string("task");
  if (task === "transcribe") return { task };
  return config.object("task")?.string("type") === "translate"
    ? { task: "translate" }
    : {};
}

function optionalString<K extends keyof MediaOperationAuthoredOptions>(
  key: K,
  value: string | undefined,
) {
  return value === undefined ? {} : { [key]: value };
}

function optionalNumber<K extends keyof MediaOperationAuthoredOptions>(
  key: K,
  value: number | undefined,
) {
  return value === undefined ? {} : { [key]: value };
}
