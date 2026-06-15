/**
 * Dialect adapters for the shared execution session.
 *
 * These helpers intentionally copy provider hooks without adding behavior.
 * The execution modules own orchestration; specs own provider mechanics.
 *
 * @internal
 * @module
 */

import type { AdapterSpec } from '../spec'
import type { ExecutorSpec } from '../executor-spec'
import type { CoreStepDialect, SdkLoopDialect } from './types'

/**
 * Convert an `AdapterSpec` and bound client into the core-step dialect.
 *
 * This is intentionally a thin adapter: all orchestration remains in
 * `createAdapterExecution()`, while every provider-specific hook continues to
 * live on the original spec.
 *
 * @param spec - Raw provider adapter specification.
 * @param client - Provider client bound by the public factory.
 * @returns A normalized dialect for the shared execution session.
 */
export function coreStepDialect<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>,
  client: TClient,
): CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra> {
  return {
    kind: 'core-step',
    id: spec.providerId,
    client,
    mapSettings: spec.mapSettings,
    call: spec.call,
    stream: spec.stream,
    appendToolRound: spec.appendToolRound,
    sanitizeToolSchema: spec.sanitizeToolSchema,
    wrapOutputSchema: spec.wrapOutputSchema,
  }
}

/**
 * Convert an `ExecutorSpec` and bound client into the SDK-loop dialect.
 *
 * The returned dialect lets the shared session apply Crux policy around an
 * SDK-owned loop without reimplementing the SDK's native orchestration model.
 *
 * @param spec - Loop-owning executor specification.
 * @param client - SDK client or gateway bound by the public factory.
 * @returns A normalized dialect for the shared execution session.
 */
export function sdkLoopDialect<TClient, TModel, TRawResponse, TRawStream>(
  spec: ExecutorSpec<TClient, TModel, TRawResponse, TRawStream>,
  client: TClient,
): SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream> {
  return {
    kind: 'sdk-loop',
    id: spec.executorId,
    client,
    describeModel: spec.describeModel,
    mapSettings: spec.mapSettings,
    runLoop: spec.runLoop,
    attemptStructured: spec.attemptStructured,
    runStream: spec.runStream,
    replayStream: spec.replayStream,
  }
}
