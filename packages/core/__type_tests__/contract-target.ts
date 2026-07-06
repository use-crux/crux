/**
 * Target compile-time contract for the pre-launch adapter API.
 *
 * This file intentionally describes the future public surface without
 * importing every live implementation type yet. Later phases replace the
 * phase-local target declarations with real imports as each contract lands.
 */

import type {
  FinalStepInfo,
  GenerateResult,
  StreamCompletion,
  StreamResult,
} from "../adapter";
import type { TimeoutBudget, TimeoutOptions } from "../generation/timeout";
import type { StopCondition, ToolChoice } from "../generation/tool-control";
import type {
  GenerationSettings,
  TokenUsage,
  TraceMeta,
} from "../generation/types";
import { TimeoutError } from "../generation/timeout";

type AssertEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
    ? (<G>() => G extends U ? 1 : 2) extends <G>() => G extends T ? 1 : 2
      ? true
      : false
    : false;

type Expect<T extends true> = T;

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

type TargetTokenUsage = TokenUsage;

type _TokenUsageRequiredKeys = Expect<
  AssertEqual<
    RequiredKeys<TargetTokenUsage>,
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "inputTokenDetails"
    | "outputTokenDetails"
  >
>;
type _TokenUsageOptionalKeys = Expect<
  AssertEqual<OptionalKeys<TargetTokenUsage>, never>
>;
type _TokenUsageInputDetails = Expect<
  AssertEqual<
    TargetTokenUsage["inputTokenDetails"],
    {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  >
>;
type _TokenUsageOutputDetails = Expect<
  AssertEqual<
    TargetTokenUsage["outputTokenDetails"],
    {
      reasoningTokens?: number;
    }
  >
>;

type TargetTimeoutBudget = TimeoutBudget;
type TargetTimeoutOptions = TimeoutOptions;
type TargetTimeoutError = TimeoutError;

type _TimeoutOptionsKeys = Expect<
  AssertEqual<
    keyof TargetTimeoutOptions,
    "totalMs" | "stepMs" | "chunkMs" | "toolMs" | "tools"
  >
>;
type _TimeoutToolsReadonly = Expect<
  AssertEqual<
    TargetTimeoutOptions["tools"],
    Readonly<Record<string, number>> | undefined
  >
>;
type _TimeoutErrorBudget = Expect<
  AssertEqual<TargetTimeoutError["budget"], TargetTimeoutBudget>
>;
type _TimeoutErrorLimit = Expect<
  AssertEqual<TargetTimeoutError["limitMs"], number>
>;
type _TimeoutErrorToolName = Expect<
  AssertEqual<TargetTimeoutError["toolName"], string | undefined>
>;

type Phase2GenerationSettings = GenerationSettings;

type _ReasoningSetting = Expect<
  AssertEqual<
    Phase2GenerationSettings["reasoning"],
    "low" | "medium" | "high" | undefined
  >
>;

type TargetGenerationSettings = GenerationSettings;

type _GenerationSettingsKeys = Expect<
  AssertEqual<
    keyof TargetGenerationSettings,
    | "temperature"
    | "maxTokens"
    | "topP"
    | "topK"
    | "stopSequences"
    | "seed"
    | "reasoning"
    | "toolChoice"
    | "stopWhen"
    | "maxSteps"
    | "frequencyPenalty"
    | "presencePenalty"
  >
>;
type _SeedSetting = Expect<
  AssertEqual<TargetGenerationSettings["seed"], number | undefined>
>;
type _StopSequencesSetting = Expect<
  AssertEqual<
    TargetGenerationSettings["stopSequences"],
    readonly string[] | undefined
  >
>;

type TargetFinalStepInfo = FinalStepInfo;
type TargetGenerateResult<TRaw, TOutput = unknown> = GenerateResult<
  TRaw,
  TOutput
>;
type TargetStreamCompletion<TOutput = unknown> = StreamCompletion<TOutput>;
type TargetStreamResult<TRawStream, TOutput = unknown> = StreamResult<
  TRawStream,
  TOutput
>;

type _GenerateResultKeys = Expect<
  AssertEqual<
    keyof TargetGenerateResult<
      { readonly provider: "raw" },
      { readonly ok: true }
    >,
    | "text"
    | "object"
    | "usage"
    | "cost"
    | "steps"
    | "finalStep"
    | "messages"
    | "pendingApprovals"
    | "raw"
    | "_meta"
  >
>;
type _GenerateResultRaw = Expect<
  AssertEqual<
    TargetGenerateResult<{ readonly provider: "raw" }>["raw"],
    { readonly provider: "raw" }
  >
>;
type _GenerateResultObject = Expect<
  AssertEqual<
    TargetGenerateResult<unknown, { readonly ok: true }>["object"],
    { readonly ok: true } | undefined
  >
>;
type _GenerateResultUsage = Expect<
  AssertEqual<
    TargetGenerateResult<unknown>["usage"],
    TargetTokenUsage | undefined
  >
>;
type _GenerateResultCost = Expect<
  AssertEqual<
    TargetGenerateResult<unknown>["cost"],
    TraceMeta["cost"] | undefined
  >
>;
type _FinalStepUsage = Expect<
  AssertEqual<
    TargetGenerateResult<unknown>["finalStep"]["usage"],
    TargetTokenUsage | undefined
  >
>;
type _StreamResultKeys = Expect<
  AssertEqual<
    keyof TargetStreamResult<{ readonly stream: true }>,
    "textStream" | "raw" | "completion"
  >
>;
type _StreamRaw = Expect<
  AssertEqual<
    TargetStreamResult<{ readonly stream: true }>["raw"],
    { readonly stream: true }
  >
>;
type _StreamCompletion = Expect<
  AssertEqual<
    TargetStreamResult<unknown, { readonly ok: true }>["completion"],
    Promise<TargetStreamCompletion<{ readonly ok: true }>>
  >
>;
type _StreamCompletionUsage = Expect<
  AssertEqual<TargetStreamCompletion["usage"], TargetTokenUsage | undefined>
>;
