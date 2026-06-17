/**
 * SDK-loop profile driver.
 *
 * @module
 */

import type { GenerationSettings, ModelInfo } from '../../types'
import type { z } from 'zod'
import { executorAdapter } from '../define-executor'
import type { CruxExecutor } from '../define-executor'
import type { ExecutorSpec } from '../executor-spec'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  StructuredAttempt,
  StructuredRequest,
} from '../executor-types'
import type { AdapterDriver, AdapterProfileContext } from './types'

/**
 * Public SDK-loop profile shape.
 *
 * Use this for SDKs that own the model/tool loop and let Crux steer policy
 * around it. The outer `defineAdapterProfile({ id, describeModel })` supplies
 * `executorId` and model identity; this profile supplies the mechanical SDK
 * hooks.
 */
export interface SdkLoopProfile<TClient, TModel, TRawResponse = unknown, TRawStream = unknown> {
  /** Map canonical generation settings to SDK-native option names. */
  settings(settings: GenerationSettings, model: ModelInfo): Record<string, unknown>
  /** Run the SDK-owned text/tool loop. */
  runLoop(client: TClient, request: ExecutorRequest<TModel>): Promise<ExecutorOutcome<TRawResponse>>
  /** Make one structured-output attempt; invalid schema results return in-band. */
  attemptStructured(client: TClient, request: StructuredRequest<TModel>): Promise<StructuredAttempt<TRawResponse>>
  /** Start a streaming generation and return the SDK stream handle. */
  runStream(
    client: TClient,
    request: ExecutorRequest<TModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<TRawStream>>
  /** Recreate a stream handle from cached semantic-cache payloads when supported. */
  replayStream?(cached: {
    readonly text?: string
    readonly object?: unknown
    readonly meta?: Record<string, unknown>
  }): ExecutorStreamHandle<TRawStream>
}

/** Runtime produced by an SDK-loop profile. */
export type SdkLoopRuntime<TClient, TModel, TRawResponse, TRawStream> = CruxExecutor<
  TClient,
  TModel,
  TRawResponse,
  TRawStream
>

/**
 * Compile an SDK-loop profile into an adapter profile driver.
 *
 * The driver creates an `ExecutorSpec` and passes it to `executorAdapter()`.
 * Core still owns routing, retries, safety, approvals, and observability;
 * the profile only maps SDK mechanics.
 *
 * @param profile - SDK-loop hooks.
 * @returns An SDK-loop driver for `defineAdapterProfile()`.
 */
export function sdkLoop<TClient, TModel, TRawResponse = unknown, TRawStream = unknown>(
  profile: SdkLoopProfile<TClient, TModel, TRawResponse, TRawStream>,
): AdapterDriver<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  Record<string, unknown>,
  Record<string, never>,
  SdkLoopRuntime<TClient, TModel, TRawResponse, TRawStream>
> {
  return Object.freeze({
    kind: 'sdk-loop' as const,
    create(
      ctx: AdapterProfileContext<TModel>,
      client: TClient,
    ): SdkLoopRuntime<TClient, TModel, TRawResponse, TRawStream> {
      const spec: ExecutorSpec<TClient, TModel, TRawResponse, TRawStream> = {
        executorId: ctx.id,
        describeModel: ctx.describeModel ?? ((model) => describeModelFallback(ctx.id, model)),
        mapSettings: profile.settings,
        runLoop: profile.runLoop,
        attemptStructured: profile.attemptStructured,
        runStream: profile.runStream,
      }

      if (profile.replayStream) {
        spec.replayStream = profile.replayStream
      }

      return executorAdapter(spec)(client)
    },
  })
}

function describeModelFallback<TModel>(profileId: string, model: TModel): ModelInfo {
  if (typeof model === 'string') {
    const separator = model.indexOf(':')
    if (separator > 0) {
      return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) }
    }
    return { provider: profileId, modelId: model }
  }

  if (typeof model === 'object' && model !== null) {
    const record = model as { readonly provider?: unknown; readonly modelId?: unknown; readonly id?: unknown }
    const provider = typeof record.provider === 'string' ? record.provider : profileId
    const modelId = typeof record.modelId === 'string' ? record.modelId : typeof record.id === 'string' ? record.id : ''
    return { provider, modelId }
  }

  return { provider: profileId, modelId: String(model) }
}
