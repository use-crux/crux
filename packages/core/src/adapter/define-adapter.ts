/**
 * `adapter()` — lower-level factory for single-turn provider execution IR.
 *
 * Accepts an `AdapterSpec` (provider-specific hooks) and returns a factory
 * `(client: TClient) => CruxAdapter`. The adapter handles prompt resolution,
 * tool loops, settings mapping, and exposes `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * Provider packages should normally use `defineSingleTurnProviderBundle()`,
 * which compiles through the single-turn provider runtime into this IR.
 *
 * @module
 */

import type { AnyPrompt } from "../prompt/prompt-types";
import type { ResolvedPrompt } from "../resolver/types";
import type { AnyToolSet } from "../types";

/**
 * Loosely-typed resolve options used at the adapter boundary.
 *
 * The adapter is generic over `AnyPrompt`, so the strongly-typed
 * `ResolveOptions<TOwnInput, TContexts>` shape is unreachable here — the
 * concrete input shape is only known to the original prompt definition.
 * We narrow from `unknown` once and reuse this contract for every call.
 */
type AdapterResolveOpts = Parameters<AnyPrompt["resolve"]>[0];
import type { AdapterSpec } from "./spec";
import { resolveModelCapacityProfile } from "../request/capacity/model-profile";
import { createCompositions } from "../agent/create-compositions";
import type { AgentExecutor } from "../agent/executor";
import { coreStepDialect, createAdapterExecution } from "./execution/session";
import { validateStructuredOutputCapabilities } from "./structured-output";
import { assertStreamHandle } from "./execution/stream-handle-guard";
import { transportDialect } from "./execution/transport-dialect";
import { CruxTransportStreamUnsupportedError } from "./transport";
import type {
  AdapterGenerateOptions,
  AdapterGenerateResult,
  AdapterStreamOptions,
  AdapterStreamResult,
  AdapterTransport,
  AdapterTransportInfo,
  CruxAdapter,
} from "./define-adapter-types";
import { createStreamResult } from "./result-accumulator";
import { mergeInputBudget } from "../request/budget/input-budget";

export type {
  AdapterGenerateOptions,
  AdapterGenerateResult,
  AdapterStreamOptions,
  AdapterStreamResult,
  AdapterTransport,
  AdapterTransportInfo,
  CruxAdapter,
} from "./define-adapter-types";

/**
 * Return a prompt view whose resolution includes additional agent tools.
 *
 * Agent composition needs tools to participate in the same adapter tool-loop
 * path as prompt-authored tools, but mutating the prompt would leak those tools
 * into later calls. This wrapper keeps the public `AnyPrompt` surface intact
 * and scopes the merge to this executor call.
 */
function withMergedPromptTools(
  prompt: AnyPrompt,
  tools: AnyToolSet,
): AnyPrompt {
  return Object.freeze({
    ...prompt,
    resolve: async (
      resolveOpts: AdapterResolveOpts,
    ): Promise<ResolvedPrompt> => {
      const resolved = await prompt.resolve(resolveOpts);
      return { ...resolved, tools: { ...(resolved.tools ?? {}), ...tools } };
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// adapter
// ─────────────────────────────────────────────────────────────────

/**
 * Create a provider adapter from an `AdapterSpec`.
 *
 * Returns a factory function: `(client: TClient) => CruxAdapter`.
 * The returned adapter has `generate()`, `stream()`, and composition
 * methods (parallel, pipeline, consensus, swarm).
 *
 * @param spec - Provider-specific adapter specification.
 * @returns A factory that creates adapter instances bound to a client.
 *
 * @example
 * ```ts
 * const createMyAdapter = adapter({
 *   providerId: 'my-provider',
 *   call: async (client, args) => { ... },
 *   stream: async (client, args) => { ... },
 *   appendToolRound: (msgs, resp, results) => [...msgs, ...],
 *   mapSettings: (s) => ({ temperature: s.temperature }),
 * })
 *
 * const adapter = createMyAdapter(myClient)
 * const result = await adapter.generate(myPrompt, { model: 'gpt-4o', input: { ... } })
 * ```
 */
export function adapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TParams = unknown,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra, TParams>,
): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra, TParams> {
  // Reject a contradictory structured-output capability profile when the
  // adapter is defined, not on the first structured request.
  if (spec.structuredOutput) {
    validateStructuredOutputCapabilities(spec.structuredOutput.accepts);
  }
  return (
    client: TClient,
  ): CruxAdapter<TClient, TRawResponse, TRawStream, TExtra, TParams> => {
    const baseDialect = coreStepDialect(spec, client);
    const execution = createAdapterExecution(baseDialect);

    // ── generate() ──────────────────────────────────────────────

    async function generate<
      TPrompt extends AnyPrompt,
      TCallTools extends AnyToolSet | undefined = undefined,
      TRuntimeContext = unknown,
    >(
      prompt: TPrompt,
      opts: AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
    ): Promise<AdapterGenerateResult<TRawResponse>> {
      const activeExecution = opts.transport
        ? createAdapterExecution(transportDialect(baseDialect, opts.transport))
        : execution;
      return (await activeExecution.generate({
        prompt,
        model: opts.model,
        modelInfo: {
          provider: opts.provider ?? spec.providerId,
          modelId: opts.model,
        },
        input: opts.input,
        provider: opts.provider,
        inputBudget: opts.inputBudget,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        extra: opts.extra,
        messages: opts.messages,
        tools: opts.tools,
        toolsContext: opts.toolsContext,
        runtimeContext: opts.runtimeContext,
        toolMiddleware: opts.toolMiddleware,
        toolApproval: opts.toolApproval,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
        safety: opts.safety,
        timeout: opts.timeout,
        signal: opts.signal,
      })) as AdapterGenerateResult<TRawResponse>;
    }

    // ── stream() ──────────────────────────────────────────────

    async function streamFn<
      TPrompt extends AnyPrompt,
      TCallTools extends AnyToolSet | undefined = undefined,
      TRuntimeContext = unknown,
    >(
      prompt: TPrompt,
      opts: AdapterStreamOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
    ): Promise<AdapterStreamResult<TPrompt>> {
      if (opts.transport) throw new CruxTransportStreamUnsupportedError(spec.providerId);
      const handle = await execution.stream({
        prompt,
        model: opts.model,
        modelInfo: {
          provider: opts.provider ?? spec.providerId,
          modelId: opts.model,
        },
        input: opts.input,
        provider: opts.provider,
        inputBudget: opts.inputBudget,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        extra: opts.extra,
        messages: opts.messages,
        tools: opts.tools,
        toolsContext: opts.toolsContext,
        runtimeContext: opts.runtimeContext,
        toolMiddleware: opts.toolMiddleware,
        toolApproval: opts.toolApproval,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
        safety: opts.safety,
        timeout: opts.timeout,
        signal: opts.signal,
      });
      assertStreamHandle<TRawStream>(handle);
      // The prompt's schema types the RESULT, not the runtime shape: one logical
      // stream is built either way, so this is a projection of the same object.
      return createStreamResult(handle) as AdapterStreamResult<TPrompt>;
    }

    // ── prepare() ──────────────────────────────────────────────

    async function prepare<
      TPrompt extends AnyPrompt,
      TCallTools extends AnyToolSet | undefined = undefined,
      TRuntimeContext = unknown,
    >(
      prompt: TPrompt,
      opts: AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
    ) {
      if (!execution.prepare) {
        throw new TypeError(`Adapter "${spec.providerId}" does not expose public call handles.`);
      }
      return execution.prepare({
        prompt,
        model: opts.model,
        modelInfo: {
          provider: opts.provider ?? spec.providerId,
          modelId: opts.model,
        },
        input: opts.input,
        provider: opts.provider,
        inputBudget: opts.inputBudget,
        maxSteps: opts.maxSteps,
        settings: opts.settings,
        extra: opts.extra,
        messages: opts.messages,
        tools: opts.tools,
        toolsContext: opts.toolsContext,
        runtimeContext: opts.runtimeContext,
        toolMiddleware: opts.toolMiddleware,
        toolApproval: opts.toolApproval,
        validationRetry: opts.validationRetry,
        constraints: opts.constraints,
        constraintMaxRetries: opts.constraintMaxRetries,
        guardrails: opts.guardrails,
        timeout: opts.timeout,
        signal: opts.signal,
      });
    }

    // ── Agent executor ──────────────────────────────────────────

    const executor: AgentExecutor = async (agent, options) => {
      const model = (agent.model as string) ?? (options.model as string);
      const start = Date.now();

      // Merge agent tools + composition-level tools into the prompt
      // so the tool loop can pick them up from the resolved prompt.
      const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) };
      const promptWithTools: AnyPrompt =
        Object.keys(mergedTools).length > 0
          ? withMergedPromptTools(agent.prompt, mergedTools)
          : agent.prompt;

      const generateOpts: AdapterGenerateOptions<TExtra, undefined, AnyPrompt, unknown, TParams, TRawResponse> = {
        model,
        input: options.input as Record<string, unknown>,
        maxSteps: options.maxSteps,
        validationRetry: options.validationRetry,
        inputBudget: mergeInputBudget(agent.inputBudget, options.inputBudget),
        extra: {} as TExtra,
      };

      const result = await generate(promptWithTools, generateOpts);

      return {
        agentId: agent.id,
        output: result.text,
        durationMs: Date.now() - start,
        usage: result._meta.usage,
      };
    };

    const compositions = createCompositions(executor);

    // ── Return frozen adapter ──────────────────────────────────

    return Object.freeze({
      providerId: spec.providerId,
      capacity: (model: string) =>
        resolveModelCapacityProfile(model, spec.capacity),
      generate,
      stream: streamFn,
      ...(execution.prepare ? { prepare } : {}),
      parallel: compositions.parallel,
      pipeline: compositions.pipeline,
      consensus: compositions.consensus,
      swarm: compositions.swarm,
    });
  };
}
