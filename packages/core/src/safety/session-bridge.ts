import type { Message } from "../generation/messages";
import type { z } from "zod";
import type { ResultStepFacts } from "../adapter/result-accumulator";
import type {
  ExecutorModelStep,
  StepContentEdit,
  StepTransformer,
} from "../adapter/executor-types";
import type { AssistantContentPart } from "../types/content";
import type { MediaGroupDependency } from "./media/groups";
import type { MediaVisitGroup, MediaVisitItem } from "./media/visit";
import type { MediaOutputResult } from "./output/media";
import type { LiveTextSlot } from "./output/completion";
import type { OperationInputTextSlot } from "./input/operation-text";
import type { Safety, SafetyOutput, SafetyStream } from "./session-contract";
import type {
  CanonicalModelIngress,
  CanonicalModelIngressResult,
  ModelIngressGuard,
} from "./input/model-ingress";
import type { InputSource } from "./input-origin";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
} from "../adapter/structured-output";
import type { ResolvedSystemIngressCarrier } from "../resolver/system-ingress-provenance";
import type { ResolvedSystemIngressDelivery } from "./input/resolved-system";
import type {
  CorrectiveWriteback,
  FeedbackIngress,
  FeedbackIngressGuard,
  SafetyRegenerate,
} from "./session-feedback-guard";
import type { ToolExposureGuards } from "../adapter/tool/exposure/types";
import type { ManagedMemoryWriteGuard } from "../memory/managed-write-guard";
import type { SafetySessionMedia } from "./session-media";
export const inputOperationMediaGuard: unique symbol = Symbol(
  "crux.safety.inputOperationMediaGuard",
);
export const inputOperationTextGuard: unique symbol = Symbol(
  "crux.safety.inputOperationTextGuard",
);
export const outputOperationTextGuard: unique symbol = Symbol(
  "crux.safety.outputOperationTextGuard",
);
export const oneShotOutputConstraints: unique symbol = Symbol(
  "crux.safety.oneShotOutputConstraints",
);
export const outputDownstreamMutators: unique symbol = Symbol(
  "@use-crux/core/safety/outputDownstreamMutators",
);

export const outputTerminalTextGuards: unique symbol = Symbol(
  "@use-crux/core/safety/outputTerminalTextGuards",
);

export const languageStepGuardEnabled: unique symbol = Symbol(
  "crux.safety.languageStepGuardEnabled",
);
export const languageStepGuard: unique symbol = Symbol(
  "crux.safety.languageStepGuard",
);
export const languageStepTransform: unique symbol = Symbol(
  "crux.safety.languageStepTransform",
);
export const languageTerminalFinalize: unique symbol = Symbol(
  "crux.safety.languageTerminalFinalize",
);
export const streamCompletionGuard: unique symbol = Symbol(
  "crux.safety.streamCompletionGuard",
);
export const structuredStreamOpen: unique symbol = Symbol(
  "crux.safety.structuredStreamOpen",
);
export const structuredStreamOpenRaw: unique symbol = Symbol(
  "crux.safety.structuredStreamOpenRaw",
);
export const streamOpenRaw: unique symbol = Symbol("crux.safety.streamOpenRaw");
export const streamCommitPlan: unique symbol = Symbol(
  "crux.safety.streamCommitPlan",
);
export const modelIngressGuard: unique symbol = Symbol(
  "crux.safety.modelIngressGuard",
);
export const modelIngressSources: unique symbol = Symbol(
  "crux.safety.modelIngressSources",
);
export const resolvedInputGuard: unique symbol = Symbol(
  "crux.safety.resolvedInputGuard",
);
export const feedbackIngressGuard: unique symbol = Symbol(
  "crux.safety.feedbackIngressGuard",
);
export const toolDefinitionGuard: unique symbol = Symbol(
  "crux.safety.toolDefinitionGuard",
);
export const toolDescriptionGuard: unique symbol = Symbol(
  "crux.safety.toolDescriptionGuard",
);
export const memoryWriteGuard: unique symbol = Symbol(
  "crux.safety.memoryWriteGuard",
);
export const representationPolicySelection: unique symbol = Symbol(
  "crux.safety.representationPolicySelection",
);

type SafetyInput = Parameters<Safety["guardInput"]>[0];
type SafetyInputResult = Awaited<ReturnType<Safety["guardInput"]>> & {
  readonly systemIngress?: ResolvedSystemIngressDelivery;
};

export interface SafetySession extends Safety, SafetySessionMedia {
  [representationPolicySelection](disabledIds: readonly string[]): void;
  [memoryWriteGuard]: ManagedMemoryWriteGuard;
  [toolDefinitionGuard]: ToolExposureGuards["root"];
  [toolDescriptionGuard]: ToolExposureGuards["descriptions"];
  [feedbackIngressGuard](input: FeedbackIngress): Promise<string>;
  [modelIngressGuard](
    input: CanonicalModelIngress,
  ): Promise<CanonicalModelIngressResult>;
  readonly [modelIngressSources]: readonly InputSource[];
  [resolvedInputGuard](
    input: SafetyInput,
    provenance: ResolvedSystemIngressCarrier | undefined,
    scope?: "full" | "carrier",
  ): Promise<SafetyInputResult>;
  readonly [languageStepGuardEnabled]: boolean;
  readonly [outputDownstreamMutators]: boolean;
  readonly [outputTerminalTextGuards]: boolean;
  [languageStepGuard](
    stepIndex: number,
    facts: ResultStepFacts,
    schema?: z.ZodType,
  ): Promise<ResultStepFacts>;
  [languageStepTransform](
    step: ExecutorModelStep,
    schema?: z.ZodType,
  ): Promise<readonly StepContentEdit[]>;
  [languageTerminalFinalize](
    output: SafetyOutput,
    regenerate: SafetyRegenerate,
    opts?: TerminalFinalizeOptions,
  ): Promise<SafetyOutput>;
  [streamCompletionGuard](
    content: readonly AssistantContentPart[],
    liveText?: string,
    representedText?: string,
    liveTextSlots?: readonly LiveTextSlot[],
  ): Promise<readonly AssistantContentPart[]>;
  [structuredStreamOpen](
    structuredContext?: StructuredSafetyContext,
  ): SafetyStream;
  [structuredStreamOpenRaw](
    structuredContext?: StructuredSafetyContext,
  ): SafetyStream;
  [streamOpenRaw](): SafetyStream;
  readonly [streamCommitPlan]: StreamCommitPlan;
  [inputOperationTextGuard](
    slots: readonly OperationInputTextSlot[],
    context?: OperationInputGuardContext,
  ): Promise<readonly OperationInputTextSlot[]>;
  [inputOperationMediaGuard](
    items: readonly MediaVisitItem[],
    groups: readonly MediaVisitGroup[],
    dependencies?: readonly MediaGroupDependency[],
  ): Promise<MediaOutputResult>;
  [outputOperationTextGuard](text: string, model?: string): Promise<string>;
  [oneShotOutputConstraints](text: string, model?: string): Promise<void>;
}

/** @internal Select the safety policies active for one represented request. */
export function selectSafetySessionRepresentationPolicies(
  safety: Safety,
  disabledIds: readonly string[],
): void {
  (safety as SafetySession)[representationPolicySelection](disabledIds);
}

/** @internal Read the managed-memory commit capability for this call. */
export function safetySessionMemoryWriteGuard(
  safety: Safety,
): ManagedMemoryWriteGuard {
  return (safety as SafetySession)[memoryWriteGuard];
}

/** @internal Read the bound root tool-definition guard. */
export function safetySessionToolDefinitionGuard(
  safety: Safety,
): ToolExposureGuards["root"] {
  return (safety as SafetySession)[toolDefinitionGuard];
}

/** @internal Read the bound tool-description guard. */
export function safetySessionToolDescriptionGuard(
  safety: Safety,
): ToolExposureGuards["descriptions"] {
  return (safety as SafetySession)[toolDescriptionGuard];
}

/** @internal Guard one corrective text occurrence before provider writeback. */
export function guardSafetySessionFeedback(
  safety: Safety,
  input: FeedbackIngress,
): Promise<string> {
  return (safety as SafetySession)[feedbackIngressGuard](input);
}

/** @internal Read the bound corrective-ingress capability for retry planners. */
export function safetySessionFeedbackGuard(
  safety: Safety,
): FeedbackIngressGuard {
  return (input) => guardSafetySessionFeedback(safety, input);
}

export type {
  CorrectiveWriteback,
  FeedbackIngress,
  FeedbackIngressGuard,
  SafetyRegenerate,
} from "./session-feedback-guard";

/** @internal Guard one post-conversion canonical model-ingress value. */
export function guardSafetySessionModelIngress(
  safety: Safety,
  input: CanonicalModelIngress,
): Promise<CanonicalModelIngressResult> {
  return (safety as SafetySession)[modelIngressGuard](input);
}

/** @internal Return the shared ingress gate only when one policy matches the source. */
export function safetySessionModelIngressGuard(
  safety: Safety,
  source: InputSource,
): ModelIngressGuard | undefined {
  const session = safety as SafetySession;
  if (!session[modelIngressSources].includes(source)) return undefined;
  return (input) => session[modelIngressGuard](input);
}

/** @internal Whether this session has an applicable per-step output guard. */
export function safetyRequiresLanguageStepTransform(safety: Safety): boolean {
  return (safety as SafetySession)[languageStepGuardEnabled];
}

/**
 * @internal Whether a terminal stage can still rewrite or remove published output.
 *
 * True when a composite `model.output` guard or an output-media guard is bound.
 * Either can change or strip content AFTER it was produced, so anything they
 * govern must not reach a public surface before they have run (RFC #173, law 3).
 */
export function safetyDefersDownstreamOutput(safety: Safety): boolean {
  return (safety as SafetySession)[outputDownstreamMutators];
}

/**
 * @internal Whether a terminal stage can still rewrite or block REASONING.
 *
 * Reasoning is guarded by `model.output.text` at completion, and the streaming
 * text transform gates only text deltas — a reasoning part passes through it
 * untouched. So whenever such a binding exists, reasoning must publish from the
 * guarded completion instead of live, or a public surface would stream content a
 * terminal stage went on to redact (RFC #173, law 2).
 */
export function safetyDefersReasoning(safety: Safety): boolean {
  const session = safety as SafetySession;
  return session[outputTerminalTextGuards] || session[outputDownstreamMutators];
}

/** @internal Guard one canonical language step before continuation. */
export function guardSafetySessionLanguageStep(
  safety: Safety,
  stepIndex: number,
  facts: ResultStepFacts,
  schema?: z.ZodType,
): Promise<ResultStepFacts> {
  return (safety as SafetySession)[languageStepGuard](stepIndex, facts, schema);
}

/** @internal Create the Core-owned pre-client-tool transformer when applicable. */
export function createSafetyLanguageStepTransformer(
  safety: Safety,
  schema?: z.ZodType,
): StepTransformer | undefined {
  if (!safetyRequiresLanguageStepTransform(safety)) return undefined;
  const session = safety as SafetySession;
  return Object.freeze({
    transform: (step: ExecutorModelStep) =>
      session[languageStepTransform](step, schema),
  });
}

/**
 * Late-bound structured-output context for one call, derived from the compiled
 * plan after tool/prompt resolution. Carries the compiler-owned canonical schema
 * (object-occurrence structural validation) and the reversible decode manifest
 * (sentinel deletion before path selection). Threaded through the symbol bridge —
 * never public session configuration — because the plan is compiled after the
 * Safety session is created.
 *
 * @internal
 */
export interface StructuredSafetyContext {
  readonly canonicalSchema?: JsonSchemaObject;
  readonly decodeManifest?: StructuredOutputDecodeManifest;
}

/**
 * Options for finalizing a terminal language candidate.
 *
 * @internal
 */
export interface TerminalFinalizeOptions {
  readonly suspended?: boolean;
  readonly messages?: readonly Message[];
  readonly schema?: z.ZodType;
  /**
   * Disable every corrective model call for a candidate-only evaluation.
   *
   * Cached candidates use this to run enforcing constraints once before
   * deciding whether to fall through to a fresh live generation.
   */
  readonly retryAuthority?: "none";
  /**
   * Whether this exact candidate already passed current per-step output gates.
   *
   * Hydrated cache candidates set this false because their stored audit is not
   * evidence that the current call's bindings evaluated them.
   */
  readonly stepOutputAlreadyGated?: boolean;
  /**
   * Adapter-owned candidate validator run between terminal guardrails and
   * constraints: the single authoritative Zod `safeParse` plus any validation
   * retry. Given the guard function so a re-prompt can re-run terminal guardrails.
   */
  readonly prepareValidated?: (
    guarded: SafetyOutput,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
  ) => Promise<SafetyOutput>;
  /** Compiled structured context for object-occurrence gating (from the plan). */
  readonly structuredContext?: StructuredSafetyContext;
  /**
   * When a live structured stream already gated the object occurrences and sealed
   * the accepted canonical value, completion consumes that value directly: object
   * occurrences are not re-gated here (exactly one authored parse still runs).
   */
  readonly objectOccurrencesAlreadyGated?: boolean;
  /**
   * Occurrence-precise constraint settlement from the accepted stream attempt. A
   * settled occurrence whose subject value is unchanged is not re-evaluated by the
   * terminal constraints (a `constraint.judge()` runs once).
   */
  readonly settled?: readonly import("./constraint/settlement").ConstraintOccurrenceSettlement[];
}

/** @internal Finalize an already step-guarded language terminal candidate. */
export function finalizeSafetySessionLanguageOutput(
  safety: Safety,
  output: SafetyOutput,
  regenerate: SafetyRegenerate,
  opts?: TerminalFinalizeOptions,
): Promise<SafetyOutput> {
  return (safety as SafetySession)[languageTerminalFinalize](
    output,
    regenerate,
    opts,
  );
}

/**
 * The resolved stream commit plan for one call: whether Safety contributes an
 * attempt-level commit gate that can reject and require a coordinated restream.
 *
 * Today the only Safety-owned commit gate is an enforce `assert` constraint (it
 * holds every byte until resolved and fails the attempt closed on failure). The
 * adapter combines this with the request's validation-retry policy to decide
 * whether to route the stream through the shared attempt coordinator. Exposed so
 * the adapter never re-inspects raw constraint config to make that decision.
 *
 * @internal
 */
export interface StreamCommitPlan {
  /** Whether any enforce `assert` constraint commits (holds + fails closed) on the stream. */
  readonly hasAssertGate: boolean;
}

/** @internal The resolved stream commit plan (assert-gate half) for this call. */
export function safetySessionStreamCommitPlan(
  safety: Safety,
): StreamCommitPlan {
  return (safety as SafetySession)[streamCommitPlan];
}

/**
 * @internal Open a structured-output stream bound to this call's object bindings.
 *
 * Late-bound with the compiled structured context (canonical schema + manifest)
 * after tool/prompt resolution — never public session configuration. The public
 * {@link Safety.openStream} stays text-only; this is the object-output driver.
 */
export function openSafetySessionStructuredStream(
  safety: Safety,
  structuredContext?: StructuredSafetyContext,
): SafetyStream {
  return (safety as SafetySession)[structuredStreamOpen](structuredContext);
}

/**
 * @internal Open the RAW (non-fail-closed) structured-output stream for the
 * coordinated adapter routes.
 *
 * Identical to {@link openSafetySessionStructuredStream} except the commit gate's
 * non-terminal {@link StreamConstraintRejection} propagates instead of being
 * translated to the public error: the shared stream-attempt coordinator consumes
 * it and retries when eligible.
 */
/**
 * Open the coordinated (raw) TEXT stream for an adapter that owns retry authority.
 *
 * Unlike `safety.openStream()`, an `assert` rejection is NOT translated into a
 * terminal error here: it surfaces as the non-terminal rejection the attempt
 * coordinator uses to discard and re-stream the attempt.
 */
export function openSafetySessionStreamRaw(safety: Safety): SafetyStream {
  return (safety as SafetySession)[streamOpenRaw]();
}

export function openSafetySessionStructuredStreamRaw(
  safety: Safety,
  structuredContext?: StructuredSafetyContext,
): SafetyStream {
  return (safety as SafetySession)[structuredStreamOpenRaw](structuredContext);
}

/** @internal Guard canonical content buffered behind a live text stream. */
export function guardSafetySessionStreamCompletion(
  safety: Safety,
  content: readonly AssistantContentPart[],
  liveText?: string,
  representedText?: string,
  liveTextSlots?: readonly LiveTextSlot[],
): Promise<readonly AssistantContentPart[]> {
  return (safety as SafetySession)[streamCompletionGuard](
    content,
    liveText,
    representedText,
    liveTextSlots,
  );
}

export interface OperationInputGuardContext {
  readonly model?: string;
  readonly systemPrompt?: string;
}

/** @internal Guard canonical completed-operation input text slots. */
export function guardSafetySessionInputOperationText(
  safety: Safety,
  slots: readonly OperationInputTextSlot[],
  context?: OperationInputGuardContext,
): Promise<readonly OperationInputTextSlot[]> {
  return (safety as SafetySession)[inputOperationTextGuard](slots, context);
}

/** @internal Guard canonical completed-operation input media. */
export function guardSafetySessionInputOperationMedia(
  safety: Safety,
  items: readonly MediaVisitItem[],
  groups: readonly MediaVisitGroup[],
  dependencies?: readonly MediaGroupDependency[],
): Promise<MediaOutputResult> {
  return (safety as SafetySession)[inputOperationMediaGuard](
    items,
    groups,
    dependencies,
  );
}

/** @internal Guard canonical completed-operation output text. */
export function guardSafetySessionOutputOperationText(
  safety: Safety,
  text: string,
  model?: string,
): Promise<string> {
  return (safety as SafetySession)[outputOperationTextGuard](text, model);
}

/** @internal Evaluate completed-operation terminal constraints exactly once. */
export function runSafetySessionOneShotOutputConstraints(
  safety: Safety,
  text: string,
  model?: string,
): Promise<void> {
  return (safety as SafetySession)[oneShotOutputConstraints](text, model);
}

// ─────────────────────────────────────────────────────────────────
