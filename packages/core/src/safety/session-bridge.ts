import type { Message } from "../generation/messages";
import type { z } from "zod";
import type { ResultStepFacts } from "../adapter/result-accumulator";
import type {
  ExecutorModelStep,
  StepContentEdit,
  StepTransformer,
} from "../adapter/executor-types";
import type { AssistantContentPart } from "../types/content";
import type { MediaPartSubject } from "./boundary";
import type { MediaGroupDependency } from "./media/groups";
import type { MediaVisitGroup, MediaVisitItem } from "./media/visit";
import type { MediaOutputResult } from "./output/media";
import type { LiveTextSlot } from "./output/completion";
import type { OperationInputTextSlot } from "./input/operation-text";
import type { Safety, SafetyOutput } from "./session-contract";

export const outputMediaGuard: unique symbol = Symbol(
  "crux.safety.outputMediaGuard",
);
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

export interface SafetySession extends Safety {
  readonly [languageStepGuardEnabled]: boolean;
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
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    opts?: {
      readonly suspended?: boolean;
      readonly messages?: readonly Message[];
      readonly schema?: z.ZodType;
    },
  ): Promise<SafetyOutput>;
  [streamCompletionGuard](
    content: readonly AssistantContentPart[],
    liveText?: string,
    representedText?: string,
    liveTextSlots?: readonly LiveTextSlot[],
  ): Promise<readonly AssistantContentPart[]>;
  [inputOperationTextGuard](
    slots: readonly OperationInputTextSlot[],
    context?: OperationInputGuardContext,
  ): Promise<readonly OperationInputTextSlot[]>;
  [inputOperationMediaGuard](
    items: readonly MediaVisitItem[],
    groups: readonly MediaVisitGroup[],
    dependencies?: readonly MediaGroupDependency[],
  ): Promise<MediaOutputResult>;
  [outputMediaGuard](
    subjects: readonly MediaPartSubject[],
    options?: {
      readonly minimumRetained?: number;
      readonly model?: string;
    },
  ): Promise<MediaOutputResult>;
  [outputOperationTextGuard](text: string, model?: string): Promise<string>;
  [oneShotOutputConstraints](text: string, model?: string): Promise<void>;
}

/** @internal Whether this session has an applicable per-step output guard. */
export function safetyRequiresLanguageStepTransform(safety: Safety): boolean {
  return (safety as SafetySession)[languageStepGuardEnabled];
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

/** @internal Finalize an already step-guarded language terminal candidate. */
export function finalizeSafetySessionLanguageOutput(
  safety: Safety,
  output: SafetyOutput,
  regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
  opts?: {
    readonly suspended?: boolean;
    readonly messages?: readonly Message[];
    readonly schema?: z.ZodType;
  },
): Promise<SafetyOutput> {
  return (safety as SafetySession)[languageTerminalFinalize](
    output,
    regenerate,
    opts,
  );
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

/** @internal Guard canonical output media for Core-owned adapter projections. */
export function guardSafetySessionOutputMedia(
  safety: Safety,
  subjects: readonly MediaPartSubject[],
  options?: {
    readonly minimumRetained?: number;
    /** Selected provider model for routed completed-operation output. */
    readonly model?: string;
  },
): Promise<MediaOutputResult> {
  return (safety as SafetySession)[outputMediaGuard](subjects, options);
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
