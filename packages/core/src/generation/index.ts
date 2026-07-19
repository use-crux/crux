/**
 * `generation/` — provider-neutral generation lifecycle policy.
 *
 * Curated domain barrel for the generation surface: model fallback, step/agent
 * retry, validation-feedback retry, JSON repair, canonical messages, generation
 * settings/metadata contracts, and the shared generate/stream orchestration the
 * adapter packages compose.
 *
 * This barrel is the intra-package and leaf-consumer entry point. Domain-internal
 * files import each other through specific `generation/<file>` paths to stay
 * cycle-free; the barrel is reserved for the root `index.ts` and tests.
 *
 * `generation/` may depend on `runtime/`, `observability/`, `cache/`, and shared
 * utilities, but never on provider SDKs or adapter execution internals.
 *
 * @module
 */

// Model fallback
export {
  fallback,
  isFallback,
  classifyError,
  shouldAttemptFallback,
} from "./fallback";
export type {
  FallbackModel,
  FallbackOptions,
  ErrorCategory,
} from "./fallback";

// Step/agent retry
export { executeWithRetry, isNonRetryableCruxPolicyError } from "./retry";
export type { RetryOptions, RetryDecisionContext } from "./retry";

// Validation-feedback retry
export {
  ValidationExhaustedError,
  isValidationExhaustedError,
} from "./validation-retry";
export type {
  ValidationRetryOptions,
  ValidationExhaustedErrorInit,
} from "./validation-retry";

// JSON repair
export { repairJsonText } from "./repair-json";

// Canonical message contract
export type { Message, CompactionResult } from "./messages";
export type { ContentPart, MessageContent } from "../types/content";

// Generation policy contracts
export { hasToolCall, maxSteps } from "./tool-control";
export type {
  HasToolCallStopCondition,
  MaxStepsStopCondition,
  StopCondition,
  ToolChoice,
} from "./tool-control";
export type {
  GenerationSettings,
  GenerationMeta,
  GenerateResultMeta,
  PromptAdaptation,
  ProviderAdaptations,
  TokenUsage,
  TraceMeta,
} from "./types";
export {
  createGeneratedImageResult,
  isNoImageGeneratedError,
  validateGenerateImageOptions,
} from "./image-result";
export { lowerImagePrompt } from "./image-prompt";
export type {
  GenerateImage,
  GenerateImageCommonOptions,
  GenerateImageOptions,
  GenerateImageResult,
  ImagePrompt,
  ImagePromptContent,
  NativeGeneratedImage,
} from "./image-contracts";
export type {
  GenerateImageResultFields,
  NoImageGeneratedError,
} from "./image-result";
export type {
  ImagePromptLoweringContext,
  LoweredImagePrompt,
} from "./image-prompt";
export {
  Deadline,
  TimeoutError,
  composeAbortSignals,
  normalizeBudgetMs,
  toolBudgetMs,
  createBudgetSignal,
  withAbortSignal,
  withBudget,
} from "./timeout";
export type {
  CompletedOperationResult,
  OperationExecution,
  OperationTimeout,
} from "../completed-operation/contracts";
export type {
  TimeoutBudget,
  TimeoutOptions,
  TimeoutErrorOptions,
  BudgetOptions,
  BudgetSignal,
} from "./timeout";

// Generate/stream orchestration (composed by adapter packages)
export { orchestrateGenerate, orchestrateStream } from "./orchestrate";
export { wrapStreamIterable } from "./stream-interception";
export type {
  OrchestrationSpec,
  TextDeltaExtractor,
} from "./orchestrate-types";
