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
import type { LoopRuntimePort } from '../loop-runtime-port'
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
  TParams = unknown,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra, TParams>,
  client: TClient,
): CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra, TParams> {
  return {
    kind: 'core-step',
    id: spec.providerId,
    client,
    mapSettings: spec.mapSettings,
    call: spec.call,
    stream: spec.stream,
    toParams: spec.toParams,
    fromResponse: spec.fromResponse,
    appendToolRound: spec.appendToolRound,
    sanitizeToolSchema: spec.sanitizeToolSchema,
    wrapOutputSchema: spec.wrapOutputSchema,
  }
}

/**
 * Tag a bound {@link LoopRuntimePort} as the SDK-loop dialect.
 *
 * The port already closes over its SDK client, so this only adds the
 * discriminant the shared session dispatches on. All orchestration stays in
 * `createAdapterExecution()`; every provider-specific hook stays on the port.
 *
 * @param port - Loop-owning runtime port (already bound to its SDK client).
 * @returns A normalized dialect for the shared execution session.
 */
export function sdkLoopDialect<TModel, TRawResponse, TRawStream>(
  port: LoopRuntimePort<TModel, TRawResponse, TRawStream>,
): SdkLoopDialect<TModel, TRawResponse, TRawStream> {
  // Forward each member explicitly (not via spread) so class-based ports keep
  // their prototype methods and receiver, and `kind` cannot be overridden.
  const dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream> = {
    kind: 'sdk-loop',
    id: port.id,
    describeModel: (model) => port.describeModel(model),
    mapSettings: (settings, model) => port.mapSettings(settings, model),
    runTextLoop: (request) => port.runTextLoop(request),
    runStructuredAttempt: (request) => port.runStructuredAttempt(request),
    runStream: (request) => port.runStream(request),
  }
  if (port.replayStream) {
    dialect.replayStream = (cached) => port.replayStream!(cached)
  }
  return dialect
}
