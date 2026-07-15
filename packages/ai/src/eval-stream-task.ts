/**
 * Managed streaming Eval task construction for the AI SDK adapter.
 *
 * Production calls retain the canonical stream handle. Private Eval execution
 * drains that handle exactly once before exposing complete semantic evidence.
 *
 * @internal
 * @module
 */

import type {
  DeepPartial,
  StreamObjectResult,
  StreamTextResult,
  ToolSet,
} from "ai";
import type { z } from "zod";
import type {
  AnyPrompt,
  AnyToolSet,
  ContextEntry,
  MergedInput,
  Prompt,
} from "@use-crux/core";
import type { StreamCompletion, StreamResult } from "@use-crux/core/adapter";
import type { EvalTask } from "@use-crux/core/eval";
import {
  attachEvalTaskDescriptorForInternalUse,
  type EvalTaskDescriptor,
} from "@use-crux/core/eval/internal/task";
import type { StreamOf } from "@use-crux/core/routing";
import type {
  AIGenerateTaskCallOptions,
  AIGenerateTaskDefaults,
  AIGenerateTaskVariant,
  AIPromptEvalCapability,
  ManagedGenerateOutput,
  StructuredPromptForModel,
  TaskCallTools,
  TaskModel,
  TaskRuntimeContext,
  ValidateTaskDefaults,
} from "./eval-task";
import { AI_PROMPT_EVAL_CAPABILITIES } from "./eval-task";
import {
  createAiTaskIdentityProjector,
  resolveAiTaskInvocation,
} from "./eval-task-identity";

type StreamingPromptForModel<P extends AnyPrompt, M> = StructuredPromptForModel<
  P,
  M
> &
  (StreamOf<M> extends true
    ? unknown
    : ["model contains a cascade; cascades are generate-only"]);

/** Rich streaming result selected from the prompt's output declaration. */
type ManagedStreamReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer TObject>
    ? StreamResult<
        StreamObjectResult<DeepPartial<TObject>, TObject, never>,
        TObject
      >
    : StreamResult<StreamTextResult<Record<string, never>, never>>;

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

type ErasedStream = (
  prompt: AnyPrompt,
  options: object,
) => Promise<StreamResult<unknown, unknown>>;

/** Build the `stream.task()` factory over one existing AI streaming path. */
export function createStreamTaskFactory(
  stream: ErasedStream,
): AIStreamTaskFactory {
  return ((prompt: AnyPrompt, defaults: object) => {
    const normalizedDefaults = Object.freeze({ ...defaults });
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
    const task = (input: unknown, callOptions?: object) =>
      invoke(input, callOptions);
    const descriptor: EvalTaskDescriptor<StreamCompletion<unknown>, unknown> = {
      _tag: "CruxEvalTaskDescriptor",
      operation: "stream",
      adapterId: "ai-sdk",
      ...(prompt.id !== undefined ? { promptId: prompt.id } : {}),
      ...(prompt.inputSchema !== undefined
        ? { inputSchema: prompt.inputSchema }
        : {}),
      outputSchema: prompt.outputSchema,
      capabilities: AI_PROMPT_EVAL_CAPABILITIES,
      defaults: normalizedDefaults,
      overrideKeys: Object.keys(normalizedDefaults),
      projectIdentity: createAiTaskIdentityProjector({
        operation: "stream",
        prompt,
        defaults: normalizedDefaults,
      }),
      execute: async (input, callOptions, overrides) =>
        drainStream(await invoke(input, callOptions, overrides)),
      projectOutput: (completion) =>
        prompt.outputSchema === undefined ? completion.text : completion.object,
      projectResponse: (completion) => Object.freeze({ ...completion }),
    };
    return attachEvalTaskDescriptorForInternalUse(task, descriptor);
  }) as unknown as AIStreamTaskFactory;
}

async function drainStream(
  result: StreamResult<unknown, unknown>,
): Promise<StreamCompletion<unknown>> {
  for await (const _delta of result.textStream) {
    // Draining is the completion contract; deltas remain on the production API.
  }
  return result.completion;
}
