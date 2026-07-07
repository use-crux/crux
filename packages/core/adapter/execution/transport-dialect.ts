/**
 * Core-step dialect wrapper for BYO transport mode.
 *
 * Transport substitutes only the provider wire call. The managed executor,
 * tools, retries, safety, and result accumulation continue to use the same
 * core-step dialect as normal managed generation.
 *
 * @internal
 * @module
 */

import type { AdapterTransport } from "../define-adapter-types";
import type { CoreStepDialect } from "./dialect-types";

/** Replace a core-step dialect's provider call with a user transport callback. */
export function transportDialect<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
  TParams,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra, TParams>,
  transport: AdapterTransport<TParams, TRawResponse>,
): CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra, TParams> {
  if (!dialect.toParams || !dialect.fromResponse) {
    throw new TypeError(`Adapter "${dialect.id}" does not expose public transport codecs.`);
  }
  let stepIndex = 0;
  return {
    ...dialect,
    async call(_client, args, context) {
      const params = await dialect.toParams!(args);
      const signal = context?.signal ?? new AbortController().signal;
      const raw = await transport(params, {
        stepIndex: stepIndex++,
        modelId: args.model,
        signal,
      });
      return { raw, extracted: dialect.fromResponse!(raw) };
    },
  };
}
