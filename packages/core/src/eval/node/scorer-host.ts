/** Node binding for planner-admitted managed scorer calls. @internal */

import type { TokenUsage } from "../../generation/types";
import type { ExternalScorerHost } from "../internal/ports";
import {
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "../internal/runner";
import { invokeScorer } from "../internal/scorers/runtime";

/** Bind managed scorers to the exact adapter context owned by their task. */
export function createNodeExternalScorerHost(): ExternalScorerHost {
  return {
    execute: async (request) => {
      if (!isManagedEvalTaskForInternalUse(request.task)) {
        throw new TypeError(
          `Managed scorer '${request.scorerName}' needs a managed task adapter binding. Use generate.task()/stream.task(), or pass explicit scorer bindings.`,
        );
      }
      const descriptor = getEvalTaskDescriptorForInternalUse(request.task);
      if (descriptor.createScorerContext === undefined) {
        throw new TypeError(
          `Managed scorer '${request.scorerName}' cannot use this task adapter because it exposes no scorer execution context. Align @use-crux/core and the adapter package, or pass explicit scorer bindings.`,
        );
      }
      let usage: TokenUsage | undefined;
      let actualUsd: number | undefined;
      const scorerContext = descriptor.createScorerContext({
        input: request.input,
        ...(request.call !== undefined ? { call: request.call } : {}),
        overrides: request.overrides,
      });
      const score = await invokeScorer(
        request.scorer,
        {
          input: request.input,
          output: request.output,
          expected: request.expected,
        },
        {
          ...scorerContext,
          recordGenerationResult(result) {
            const observed = observedGenerationMetrics(result);
            if (observed.usage !== undefined) {
              usage = addTokenUsage(usage, observed.usage);
            }
            if (observed.actualUsd !== undefined) {
              actualUsd = (actualUsd ?? 0) + observed.actualUsd;
            }
          },
        },
      );
      return {
        score,
        ...(usage !== undefined ? { usage } : {}),
        ...(actualUsd !== undefined ? { actualUsd } : {}),
      };
    },
  };
}

function observedGenerationMetrics(result: unknown): {
  readonly usage?: TokenUsage;
  readonly actualUsd?: number;
} {
  if (result === null || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  const usage = validTokenUsage(record.usage) ? record.usage : undefined;
  const meta =
    record._meta !== null && typeof record._meta === "object"
      ? (record._meta as Record<string, unknown>)
      : undefined;
  const cost = record.cost ?? meta?.cost;
  return {
    ...(usage !== undefined ? { usage } : {}),
    ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0
      ? { actualUsd: cost }
      : {}),
  };
}

function validTokenUsage(value: unknown): value is TokenUsage {
  if (value === null || typeof value !== "object") return false;
  const usage = value as Record<string, unknown>;
  return (
    [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
      isNonNegativeInteger,
    ) &&
    validTokenDetails(usage.inputTokenDetails, [
      "cacheReadTokens",
      "cacheWriteTokens",
    ]) &&
    validTokenDetails(usage.outputTokenDetails, ["reasoningTokens"])
  );
}

function validTokenDetails(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  return keys.every(
    (key) => details[key] === undefined || isNonNegativeInteger(details[key]),
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function addTokenUsage(
  current: TokenUsage | undefined,
  next: TokenUsage,
): TokenUsage {
  return {
    inputTokens: (current?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + next.outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + next.totalTokens,
    inputTokenDetails: {
      ...sumOptionalTokenDetail(
        current?.inputTokenDetails.cacheReadTokens,
        next.inputTokenDetails.cacheReadTokens,
        "cacheReadTokens",
      ),
      ...sumOptionalTokenDetail(
        current?.inputTokenDetails.cacheWriteTokens,
        next.inputTokenDetails.cacheWriteTokens,
        "cacheWriteTokens",
      ),
    },
    outputTokenDetails: sumOptionalTokenDetail(
      current?.outputTokenDetails.reasoningTokens,
      next.outputTokenDetails.reasoningTokens,
      "reasoningTokens",
    ),
  };
}

function sumOptionalTokenDetail<K extends string>(
  current: number | undefined,
  next: number | undefined,
  key: K,
): Partial<Record<K, number>> {
  return current === undefined && next === undefined
    ? {}
    : ({ [key]: (current ?? 0) + (next ?? 0) } as Partial<Record<K, number>>);
}
