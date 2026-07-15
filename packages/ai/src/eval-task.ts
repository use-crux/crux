/**
 * Managed Eval task construction for the AI SDK adapter.
 *
 * This module keeps the private Core protocol and rich AI production result
 * projection behind the small `generate.task()` surface.
 *
 * @internal
 * @module
 */

import type { GenerateObjectResult, LanguageModel, ToolSet } from "ai";
import type { z } from "zod";
import type {
  AnyPrompt,
  AnyToolSet,
  ContextEntry,
  MergedInput,
  Prompt,
} from "@use-crux/core";
import type { GenerateResult, StreamCompletion } from "@use-crux/core/adapter";
import type { EvalTask } from "@use-crux/core/eval";
import {
  attachEvalTaskDescriptorForInternalUse,
  type EvalTaskDescriptor,
} from "@use-crux/core/eval/internal/task";
import type { BoundOk, InputOk, PromptInputOf } from "@use-crux/core/routing";
import type { AIGenerateOptions } from "./options";

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
    z.ZodType,
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

/** Remaining per-call overrides after a task binds its defaults. */
export type AIGenerateTaskCallOptions<TDefaults extends object> =
  Partial<TDefaults>;

type StructuredPromptForModel<P extends AnyPrompt, M> = P &
  BoundOk<M, P> &
  InputOk<M, PromptInputOf<P>>;

type StructuredGenerateReturn<TOutput extends z.ZodType> = GenerateResult<
  GenerateObjectResult<z.output<TOutput>> | undefined,
  z.output<TOutput>
>;

/** Factory attached as `generate.task()` on every AI adapter instance. */
export interface AIGenerateTaskFactory {
  <
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType,
    TContexts extends readonly ContextEntry[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    TCallTools extends ToolSet | undefined = undefined,
    TRuntimeContext = unknown,
    TModel = LanguageModel,
  >(
    prompt: StructuredPromptForModel<
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TModel
    >,
    defaults: AIGenerateTaskDefaults<
      TOwnInput,
      TContexts,
      TCallTools,
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TRuntimeContext,
      TModel
    >,
  ): EvalTask<
    MergedInput<TOwnInput, TContexts>,
    StructuredGenerateReturn<TOutput>,
    z.output<TOutput>,
    AIGenerateTaskCallOptions<
      AIGenerateTaskDefaults<
        TOwnInput,
        TContexts,
        TCallTools,
        Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
        TRuntimeContext,
        TModel
      >
    >,
    AIGenerateTaskCallOptions<
      AIGenerateTaskDefaults<
        TOwnInput,
        TContexts,
        TCallTools,
        Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
        TRuntimeContext,
        TModel
      >
    >,
    AIPromptEvalCapability
  >;
}

type ErasedGenerate = (
  prompt: AnyPrompt,
  options: object,
) => Promise<GenerateResult<unknown, unknown>>;

const PROMPT_CAPABILITIES = Object.freeze([
  "modelCalls",
  "citations",
  "safety",
  "decisionReport",
] satisfies readonly AIPromptEvalCapability[]);

/** Build the `generate.task()` factory over one existing AI generation path. */
export function createGenerateTaskFactory(
  generate: ErasedGenerate,
): AIGenerateTaskFactory {
  return ((prompt: AnyPrompt, defaults: object) => {
    const normalizedDefaults = Object.freeze({ ...defaults });
    const invoke = (input: unknown, callOptions: object = {}) =>
      generate(prompt, { ...normalizedDefaults, ...callOptions, input });
    const task = (input: unknown, callOptions?: object) =>
      invoke(input, callOptions);
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
      capabilities: PROMPT_CAPABILITIES,
      defaults: normalizedDefaults,
      overrideKeys: Object.keys(normalizedDefaults),
      execute: invoke,
      projectOutput: (result) => result.object,
      projectResponse: normalizedResponse,
    };
    return attachEvalTaskDescriptorForInternalUse(task, descriptor);
  }) as AIGenerateTaskFactory;
}

function normalizedResponse<TOutput>(
  result: GenerateResult<unknown, TOutput>,
): StreamCompletion<TOutput> {
  const { raw: _raw, _meta: _meta, ...response } = result;
  return Object.freeze(response);
}
