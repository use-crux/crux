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
import { createCompositions } from "../agent/create-compositions";
import type { AgentExecutor } from "../agent/executor";
import { coreStepDialect, createAdapterExecution } from "./execution/session";
import { assertStreamHandle } from "./execution/stream-handle-guard";
import type {
  AdapterGenerateOptions,
  AdapterGenerateResult,
  AdapterStreamOptions,
  CruxAdapter,
} from "./define-adapter-types";
import { createStreamResult, type StreamResult } from "./result-accumulator";

export type {
  AdapterGenerateOptions,
  AdapterGenerateResult,
  AdapterStreamOptions,
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
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>,
): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> {
  return (
    client: TClient,
  ): CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> => {
    const execution = createAdapterExecution(coreStepDialect(spec, client));

    // ── generate() ──────────────────────────────────────────────

    async function generate<
      TPrompt extends AnyPrompt,
      TCallTools extends AnyToolSet | undefined = undefined,
      TRuntimeContext = unknown,
    >(
      prompt: TPrompt,
      opts: AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext>,
    ): Promise<AdapterGenerateResult<TRawResponse>> {
      return (await execution.generate({
        prompt,
        model: opts.model,
        modelInfo: {
          provider: opts.provider ?? spec.providerId,
          modelId: opts.model,
        },
        input: opts.input,
        provider: opts.provider,
        tokenBudget: opts.tokenBudget,
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
      })) as AdapterGenerateResult<TRawResponse>;
    }

    // ── stream() ──────────────────────────────────────────────

    async function streamFn<
      TPrompt extends AnyPrompt,
      TCallTools extends AnyToolSet | undefined = undefined,
      TRuntimeContext = unknown,
    >(
      prompt: TPrompt,
      opts: AdapterStreamOptions<TExtra, TCallTools, TPrompt, TRuntimeContext>,
    ): Promise<StreamResult<TRawStream>> {
      const handle = await execution.stream({
        prompt,
        model: opts.model,
        modelInfo: {
          provider: opts.provider ?? spec.providerId,
          modelId: opts.model,
        },
        input: opts.input,
        provider: opts.provider,
        tokenBudget: opts.tokenBudget,
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
      });
      assertStreamHandle<TRawStream>(handle);
      return createStreamResult(handle);
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

      const generateOpts: AdapterGenerateOptions<TExtra> = {
        model,
        input: options.input as Record<string, unknown>,
        maxSteps: options.maxSteps,
        validationRetry: options.validationRetry,
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
      generate,
      stream: streamFn,
      parallel: compositions.parallel,
      pipeline: compositions.pipeline,
      consensus: compositions.consensus,
      swarm: compositions.swarm,
    });
  };
}
