/**
 * Adapter-bound `GenerationModel` construction for the Vercel AI SDK.
 *
 * `aiSdk(native)` freezes portable identity, capabilities, and opaque
 * execution authority around an adapter-native model or same-adapter router.
 * Application code never supplies capabilities or a global executor binding.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import type { AdapterBoundGenerationModel } from "@use-crux/core";
import type { AgentExecutor } from "@use-crux/core/agent";
import {
  defineGenerationModel,
  type GenerationRuntimePort,
} from "@use-crux/core/adapter-authoring";
import { liveSdkGateway } from "./gateway";
import {
  deriveAiSdkIdentity,
  definitionIdFor,
  fingerprintFor,
} from "./generation-model-identity";
import {
  AI_SDK_ADAPTER_IDENTITY,
  AI_SDK_GENERATION_CAPABILITIES,
  isBoundGenerationModel,
} from "./generation-model-shared";
import { aiSdkProviderRuntime } from "./profile";

export {
  AI_SDK_ADAPTER_IDENTITY,
  isBoundGenerationModel,
} from "./generation-model-shared";

/**
 * Native AI SDK language model or same-adapter Crux route tree accepted by
 * {@link aiSdk}.
 */
export type AiSdkGenerationSource = LanguageModel | object;

/**
 * Bind a native AI SDK model or same-adapter router to portable execution
 * authority.
 *
 * One argument only: this adapter owns capability derivation from native
 * identity and catalog evidence. Returns a frozen {@link AdapterBoundGenerationModel}
 * via Core's adapter-authoring seam — not a registry and not a global config.
 *
 * @param native - AI SDK language model or same-adapter Crux route tree.
 * @returns Frozen bound model carrying secret-free identity and an opaque
 *   runtime port that can construct an {@link AgentExecutor}.
 *
 * @example
 * ```ts
 * import { aiSdk } from '@use-crux/ai'
 *
 * export const economy = aiSdk(nativeModel('nebula-text-v2'))
 * const writer = agent({ id: 'writer', prompt: writerPrompt, model: economy })
 * ```
 */
export function aiSdk<const TNative extends AiSdkGenerationSource>(
  native: TNative,
): AdapterBoundGenerationModel<TNative, typeof AI_SDK_GENERATION_CAPABILITIES> {
  const identity = deriveAiSdkIdentity(native);
  const definitionId = definitionIdFor(identity);
  return defineGenerationModel({
    adapter: AI_SDK_ADAPTER_IDENTITY,
    native,
    definition: {
      id: definitionId,
      fingerprint: fingerprintFor(identity),
    },
    identity,
    capabilities: AI_SDK_GENERATION_CAPABILITIES,
    runtime: createAiSdkRuntimePort(),
  });
}

/**
 * True when value is an AI SDK adapter-bound generation model.
 *
 * Prefer {@link isBoundGenerationModel} when any adapter's bound value is valid.
 */
export function isAiSdkBoundModel(
  value: unknown,
): value is AdapterBoundGenerationModel {
  return (
    isBoundGenerationModel(value) &&
    value.adapter.id === AI_SDK_ADAPTER_IDENTITY.id
  );
}

/**
 * Resolve the adapter-native model value for provider I/O.
 * Bound models unwrap to their native leaf; other values pass through.
 */
export function resolveAiSdkNativeModel(model: unknown): unknown {
  return isAiSdkBoundModel(model) ? model.native : model;
}

function createAiSdkRuntimePort(): GenerationRuntimePort {
  return {
    createAgentExecutor(): AgentExecutor {
      const runtime = aiSdkProviderRuntime.create(liveSdkGateway());
      return async (agent, options) => {
        const model = resolveAiSdkNativeModel(agent.model ?? options.model);
        if (model === undefined) {
          throw new TypeError(
            "aiSdk() AgentExecutor requires a model on the Agent or ExecuteOptions.",
          );
        }
        const start = Date.now();
        const mergedTools = {
          ...(agent.tools ?? {}),
          ...(options.tools ?? {}),
        };
        const result = await runtime.generate(agent.prompt, {
          model,
          input: options.input as Record<string, unknown>,
          maxSteps: options.maxSteps,
          validationRetry: options.validationRetry,
          inputBudget: options.inputBudget ?? agent.inputBudget,
          prepareStep: options.prepareStep ?? agent.prepareStep,
          activeTools: options.activeTools,
          signal: options.signal,
          ...(Object.keys(mergedTools).length > 0
            ? { tools: mergedTools }
            : {}),
        } as never);
        return {
          agentId: agent.id,
          output: result.object ?? result.text,
          durationMs: Date.now() - start,
          usage: result._meta.usage,
          requests: Object.freeze(
            result.steps.flatMap((step) =>
              step.request ? [step.request] : [],
            ),
          ),
          ...(result.threadCommit ? { threadCommit: result.threadCommit } : {}),
        };
      };
    },
  };
}
