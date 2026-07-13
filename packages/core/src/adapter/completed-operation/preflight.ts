/** Support preflight for every leaf model before completed-media I/O. */

import type { CompletedOperationResult } from "../../completed-operation/contracts";
import { createUnsupportedCapabilityError } from "../../content/media-errors";
import type { CompletedOperationDefinition } from "./definition";
import { completedLifecycleContext, withSelectedModel } from "./lifecycle";
import { completedModelLeaves } from "./routing";

/** Normalize and reject known-unsupported leaves before any provider call. */
export async function preflightCompletedCandidates<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  options: Readonly<{
    definition: CompletedOperationDefinition<
      TModel,
      TInput,
      TNormalized,
      TNative,
      TResult,
      TReport
    >;
    provider: string;
    operation: string;
    model: unknown;
    input: TInput;
  }>,
  signal: AbortSignal,
): Promise<ReadonlyMap<unknown, TNormalized>> {
  const prepared = new Map<unknown, TNormalized>();
  for (const candidate of unique(completedModelLeaves(options.model))) {
    throwIfAborted(signal);
    const context = completedLifecycleContext(options, candidate as TModel);
    const candidateInput = withSelectedModel(options.input, candidate);
    const normalized = await options.definition.normalize(
      candidateInput,
      context,
    );
    prepared.set(candidate, normalized);
    if (options.definition.support(normalized, context) === "unsupported") {
      throw createUnsupportedCapabilityError({
        adapter: options.provider,
        model: describeModel(candidate),
        issues: [{ capability: options.operation }],
      });
    }
  }
  throwIfAborted(signal);
  return prepared;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("aborted", "AbortError");
}

function unique(values: readonly unknown[]): readonly unknown[] {
  return [...new Set(values)];
}

function describeModel(model: unknown): string {
  if (typeof model === "string") return model;
  if (typeof model === "object" && model !== null) {
    const value = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof value.modelId === "string") return value.modelId;
    if (typeof value.id === "string") return value.id;
  }
  return String(model);
}
