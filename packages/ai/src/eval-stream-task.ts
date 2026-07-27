/**
 * Managed streaming Eval task construction for the AI SDK adapter.
 *
 * Production calls retain the canonical stream handle. Private Eval execution
 * drains that handle exactly once before exposing complete semantic evidence.
 *
 * @internal
 * @module
 */

import type { ToolSet } from "ai";
import type { z } from "zod";
import type {
  AnyPrompt,
  AnyToolSet,
  ContextEntry,
  MergedInput,
  Prompt,
} from "@use-crux/core";
import type {
  DeepPartial,
  StreamCompletion,
  StreamResult,
} from "@use-crux/core/adapter";
import type { EvalTask } from "@use-crux/core/eval";
import {
  EVAL_TASK_IDENTITY_EPOCH,
  attachEvalTaskDescriptorForInternalUse,
  type EvalTaskDescriptor,
} from "@use-crux/core/eval/internal/task";
import type { StreamOf } from "@use-crux/core/routing";
import type {
  AIGenerateTaskCallOptions,
  AIGenerateTaskCall,
  AIGenerateTaskDefaults,
  StructuredPromptForModel,
  TaskCallTools,
  TaskModel,
  TaskRuntimeContext,
  ValidateTaskDefaults,
} from "./eval-task-options";
import type {
  AIGenerateTaskVariant,
  AIPromptEvalCapability,
  ManagedGenerateOutput,
} from "./eval-task";
import { AI_PROMPT_EVAL_CAPABILITIES } from "./eval-task";
import {
  aiTaskCallContract,
  validateAiTaskVariantCall,
  validateAiTaskVariantInput,
  validateAiTaskVariantOverrides,
} from "./eval-task-variant";
import {
  createAiScorerContextBinder,
  createAiScorerContextProjector,
  createAiTaskIdentityProjector,
  resolveAiTaskInvocation,
} from "./eval-task-identity";
import { projectSchema } from "./eval-task-identity-projection";
import { createAiTaskCostEstimator } from "./eval-task-cost";
import { createRenderedPromptIdentity } from "./eval-rendered-prompt-identity";

type StreamingPromptForModel<P extends AnyPrompt, M> = StructuredPromptForModel<
  P,
  M
> &
  (StreamOf<M> extends true
    ? unknown
    : ["model contains a cascade; cascades are generate-only"]);

/**
 * Managed streaming result selected from the prompt's output declaration.
 *
 * @remarks
 * Only the VALUE types vary: the logical result shape is identical for text and
 * structured prompts (RFC #173).
 */
type ManagedStreamReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType
    ? StreamResult<z.output<TOutput>, DeepPartial<z.input<TOutput>>>
    : StreamResult<never, never>;

/** Factory attached as `stream.task()` on every AI adapter instance. */
export interface AIStreamTaskFactory {
  <
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly ContextEntry[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    const TDefaults extends object = {},
  >(
    prompt: StreamingPromptForModel<
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
    ManagedStreamReturn<TOutput>,
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

type ErasedStream = (
  prompt: AnyPrompt,
  options: object,
) => Promise<StreamResult<unknown, unknown>>;
type ErasedGenerate = (prompt: AnyPrompt, options: object) => Promise<unknown>;

/** Build the `stream.task()` factory over one existing AI streaming path. */
export function createStreamTaskFactory(
  stream: ErasedStream,
  generate: ErasedGenerate,
  options: { readonly executionContractKnown: boolean },
): AIStreamTaskFactory {
  return ((prompt: AnyPrompt, defaults: object) => {
    const normalizedDefaults = Object.freeze({ ...defaults });
    const renderedPromptIdentity = createRenderedPromptIdentity<
      StreamCompletion<unknown>
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
      return stream(invocation.prompt, { ...invocation.options, input });
    };
    const task = Object.assign(
      (input: unknown, callOptions?: object) => invoke(input, callOptions),
      { _tag: "CruxTask" as const, operation: "stream" as const },
    );
    const descriptor: EvalTaskDescriptor<StreamCompletion<unknown>, unknown> = {
      _tag: "CruxEvalTaskDescriptor",
      identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
      operation: "stream",
      adapterId: "ai-sdk",
      ...(prompt.id !== undefined ? { promptId: prompt.id } : {}),
      ...(prompt.inputSchema !== undefined
        ? { inputSchema: prompt.inputSchema }
        : {}),
      outputSchema: prompt.outputSchema,
      ...(schemaContract(prompt.outputSchema) !== undefined
        ? { outputContractFingerprint: schemaContract(prompt.outputSchema) }
        : {}),
      ...(aiTaskCallContract("stream", normalizedDefaults) !== undefined
        ? {
            callContractFingerprint: aiTaskCallContract(
              "stream",
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
        operation: "stream",
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
          async (effectivePrompt, options) =>
            drainStream(await stream(effectivePrompt, options)),
          {
            input,
            ...(callOptions !== undefined ? { call: callOptions } : {}),
            overrides,
            executionContext,
          },
        ),
      projectOutput: (completion) =>
        prompt.outputSchema === undefined ? completion.text : completion.object,
      projectResponse: (completion) => Object.freeze({ ...completion }),
    };
    return attachEvalTaskDescriptorForInternalUse(task, descriptor);
  }) as unknown as AIStreamTaskFactory;
}

function schemaContract(schema: unknown): string | undefined {
  const projected = projectSchema(schema);
  return projected.ok ? JSON.stringify(projected.value) : undefined;
}

async function drainStream(
  result: StreamResult<unknown, unknown>,
): Promise<StreamCompletion<unknown>> {
  for await (const _delta of result.textStream) {
    // Draining is the completion contract; deltas remain on the production API.
  }
  return result.completion;
}
