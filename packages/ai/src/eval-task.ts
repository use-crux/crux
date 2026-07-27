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
  EVAL_TASK_IDENTITY_EPOCH,
  attachEvalTaskDescriptorForInternalUse,
  type EvalTaskDescriptor,
} from "@use-crux/core/eval/internal/task";
import type { AISupportedModel } from "./options";
import type {
  AIGenerateTaskCall,
  AIGenerateTaskCallOptions,
  AIGenerateTaskDefaults,
  StructuredPromptForModel,
  TaskCallTools,
  TaskModel,
  TaskRuntimeContext,
  ValidateTaskDefaults,
} from "./eval-task-options";
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
      AIGenerateTaskCall<
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
      identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
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
      execute: (input, callOptions, overrides, executionContext) =>
        renderedPromptIdentity.execute(
          (effectivePrompt, options) => generate(effectivePrompt, options),
          {
            input,
            ...(callOptions !== undefined ? { call: callOptions } : {}),
            overrides,
            executionContext,
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
