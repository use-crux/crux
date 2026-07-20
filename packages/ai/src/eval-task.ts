/**
 * Managed Eval task construction for the AI SDK adapter.
 *
 * This module keeps the private Core protocol and rich AI production result
 * projection behind the small `generate.task()` surface.
 *
 * @internal
 * @module
 */

import type { GenerateObjectResult, GenerateTextResult, ToolSet } from "ai";
import type { z } from "zod";
import type {
  AnyPrompt,
  AnyToolSet,
  ContextEntry,
  GenerationSettings,
  MergedInput,
  Prompt,
} from "@use-crux/core";
import type { GenerateResult, StreamCompletion } from "@use-crux/core/adapter";
import type { EvalTask, EvalTaskLike } from "@use-crux/core/eval";
import {
  attachEvalTaskDescriptorForInternalUse,
  type EvalTaskDescriptor,
} from "@use-crux/core/eval/internal/task";
import type { BoundOk, InputOk, PromptInputOf } from "@use-crux/core/routing";
import type { AIGenerateOptions, AISupportedModel } from "./options";
import {
  createAiTaskIdentityProjector,
  createAiScorerContextBinder,
  createAiScorerContextProjector,
  resolveAiTaskInvocation,
} from "./eval-task-identity";
import { projectJson, projectSchema } from "./eval-task-identity-projection";
import {
  aiTaskCallContract,
  validateAiTaskVariantCall,
  validateAiTaskVariantInput,
  validateAiTaskVariantOverrides,
} from "./eval-task-variant";
import { createAiTaskCostEstimator } from "./eval-task-cost";
import { createRenderedPromptIdentity } from "./eval-rendered-prompt-identity";

/** Full trace-signal set captured by a prompt-backed task. */
export type AIPromptEvalCapability =
  | "modelCalls"
  | "citations"
  | "safety"
  | "decisionReport";

/** Input-independent options bound when a structured task is created. */
export type AIGenerateTaskDefaults<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
  TCallTools extends ToolSet | undefined,
  TPrompt extends Prompt<
    TOwnInput,
    z.ZodType | undefined,
    TContexts,
    AnyToolSet | undefined
  >,
  TRuntimeContext,
  TModel,
> = Omit<
  AIGenerateOptions<
    TOwnInput,
    TContexts,
    TCallTools,
    TPrompt,
    TRuntimeContext,
    TModel
  >,
  "input"
>;

/** Flatten an inferred option intersection at the public callable boundary. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Remaining per-call options after exact task defaults have been bound. */
export type AIGenerateTaskCallOptions<
  TCall extends object,
  TDefaults extends object,
> = Simplify<
  Omit<TCall, keyof TDefaults> &
    Partial<Pick<TCall, Extract<keyof TDefaults, keyof TCall>>>
>;

/** Validate only the keys a caller actually binds as task defaults. */
export type ValidateTaskDefaults<
  TDefaults extends object,
  TCall extends object,
> = {
  [K in keyof TDefaults]: K extends keyof TCall ? TCall[K] : never;
};

/** Model or routing tree bound by the exact defaults object. */
export type TaskModel<TDefaults extends object> = TDefaults extends {
  readonly model: infer TModel extends AISupportedModel;
}
  ? TModel
  : AISupportedModel;

/** Call-tool surface bound by defaults, or the normal open call-site surface. */
export type TaskCallTools<TDefaults extends object> = TDefaults extends {
  readonly tools: infer TTools extends ToolSet;
}
  ? TTools
  : ToolSet | undefined;

/** Runtime context bound by defaults when one is authored. */
export type TaskRuntimeContext<TDefaults extends object> = TDefaults extends {
  readonly runtimeContext: infer TRuntimeContext;
}
  ? TRuntimeContext
  : unknown;

export type StructuredPromptForModel<P extends AnyPrompt, M> = P &
  BoundOk<M, P> &
  InputOk<M, PromptInputOf<P>>;

/** Rich production result selected from the prompt's output declaration. */
type ManagedGenerateReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer TObject>
    ? GenerateResult<GenerateObjectResult<TObject> | undefined, TObject>
    : GenerateResult<
        GenerateTextResult<Record<string, never>, never> | undefined
      >;

/** Semantic value assessed by Eval checks for one managed prompt. */
export type ManagedGenerateOutput<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType ? z.output<TOutput> : string;

/** Comparison dimensions declared by a managed prompt task. */
export type AIGenerateTaskVariant<TPrompt extends AnyPrompt> =
  Partial<GenerationSettings> & {
    readonly task?: EvalTaskLike;
    readonly prompt?: TPrompt;
    readonly model?: AISupportedModel;
  };

/** Factory attached as `generate.task()` on every AI adapter instance. */
export interface AIGenerateTaskFactory {
  <
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly ContextEntry[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    const TDefaults extends object = {},
  >(
    prompt: StructuredPromptForModel<
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TaskModel<TDefaults>
    >,
    defaults: TDefaults &
      ValidateTaskDefaults<
        TDefaults,
        AIGenerateTaskDefaults<
          TOwnInput,
          TContexts,
          TaskCallTools<TDefaults>,
          Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
          TaskRuntimeContext<TDefaults>,
          TaskModel<TDefaults>
        >
      >,
  ): EvalTask<
    MergedInput<TOwnInput, TContexts>,
    ManagedGenerateReturn<TOutput>,
    ManagedGenerateOutput<TOutput>,
    AIGenerateTaskCallOptions<
      AIGenerateTaskDefaults<
        TOwnInput,
        TContexts,
        TaskCallTools<TDefaults>,
        Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
        TaskRuntimeContext<TDefaults>,
        TaskModel<TDefaults>
      >,
      TDefaults
    >,
    AIGenerateTaskVariant<Prompt<TOwnInput, TOutput, TContexts, TPromptTools>>,
    AIPromptEvalCapability
  >;
}

type ErasedGenerate = (
  prompt: AnyPrompt,
  options: object,
) => Promise<GenerateResult<unknown, unknown>>;

export const AI_PROMPT_EVAL_CAPABILITIES = Object.freeze([
  "modelCalls",
  "citations",
  "safety",
  "decisionReport",
] satisfies readonly AIPromptEvalCapability[]);

/** Build the `generate.task()` factory over one existing AI generation path. */
export function createGenerateTaskFactory(
  generate: ErasedGenerate,
  options: { readonly executionContractKnown: boolean },
): AIGenerateTaskFactory {
  return ((prompt: AnyPrompt, defaults: object) => {
    const normalizedDefaults = Object.freeze({ ...defaults });
    const renderedPromptIdentity = createRenderedPromptIdentity<
      GenerateResult<unknown, unknown>
    >({ prompt, defaults: normalizedDefaults });
    const invoke = (
      input: unknown,
      callOptions: object = {},
      overrides: object = {},
    ) => {
      const invocation = resolveAiTaskInvocation(
        prompt,
        normalizedDefaults,
        callOptions,
        overrides,
      );
      return generate(invocation.prompt, { ...invocation.options, input });
    };
    const task = Object.assign(
      (input: unknown, callOptions?: object) => invoke(input, callOptions),
      { _tag: "CruxTask" as const, operation: "generate" as const },
    );
    const descriptor: EvalTaskDescriptor<
      GenerateResult<unknown, unknown>,
      unknown
    > = {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      ...(prompt.id !== undefined ? { promptId: prompt.id } : {}),
      ...(prompt.inputSchema !== undefined
        ? { inputSchema: prompt.inputSchema }
        : {}),
      outputSchema: prompt.outputSchema,
      ...(schemaContract(prompt.outputSchema) !== undefined
        ? { outputContractFingerprint: schemaContract(prompt.outputSchema) }
        : {}),
      ...(aiTaskCallContract("generate", normalizedDefaults) !== undefined
        ? {
            callContractFingerprint: aiTaskCallContract(
              "generate",
              normalizedDefaults,
            ),
          }
        : {}),
      capabilities: AI_PROMPT_EVAL_CAPABILITIES,
      defaults: normalizedDefaults,
      overrideKeys: Object.keys(normalizedDefaults),
      validateVariantOverrides: (overrides) =>
        validateAiTaskVariantOverrides(overrides, prompt),
      validateVariantInput: validateAiTaskVariantInput,
      validateVariantCall: (call, overrides) =>
        validateAiTaskVariantCall(call, overrides, normalizedDefaults),
      projectIdentity: createAiTaskIdentityProjector({
        operation: "generate",
        prompt,
        defaults: normalizedDefaults,
        executionContractKnown: options.executionContractKnown,
      }),
      projectRenderedPromptIdentity: renderedPromptIdentity.project,
      readRenderedPromptIdentity: renderedPromptIdentity.read,
      projectScorerContext: createAiScorerContextProjector({
        prompt,
        defaults: normalizedDefaults,
        generate: generate as never,
        executionContractKnown: options.executionContractKnown,
      }),
      createScorerContext: createAiScorerContextBinder({
        prompt,
        defaults: normalizedDefaults,
        generate: generate as never,
      }),
      estimateCost: createAiTaskCostEstimator({
        prompt,
        defaults: normalizedDefaults,
      }),
      execute: (input, callOptions, overrides = {}) =>
        renderedPromptIdentity.execute(
          (effectivePrompt, options) => generate(effectivePrompt, options),
          {
            input,
            ...(callOptions !== undefined ? { call: callOptions } : {}),
            overrides,
          },
        ),
      projectOutput: (result) =>
        prompt.outputSchema === undefined ? result.text : result.object,
      projectResponse: normalizedResponse,
    };
    return attachEvalTaskDescriptorForInternalUse(task, descriptor);
  }) as AIGenerateTaskFactory;
}

function schemaContract(schema: unknown): string | undefined {
  const projected = projectSchema(schema);
  return projected.ok ? JSON.stringify(projected.value) : undefined;
}

function normalizedResponse<TOutput>(
  result: GenerateResult<unknown, TOutput>,
): StreamCompletion<TOutput> {
  const { raw: _raw, ...response } = result;
  const projected = projectJson(response);
  return projected.ok
    ? (projected.value as unknown as StreamCompletion<TOutput>)
    : Object.freeze(response);
}
