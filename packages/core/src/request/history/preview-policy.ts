/**
 * Read-only managed-history policy projection for request preview.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import {
  findHistorySummaryArtifact,
} from "../artifacts/lifecycle";
import type { RequestWarning } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import {
  managedSummaryMessages,
  splitManagedHistory,
} from "./managed-policy";
import type { ManagedHistoryProjection } from "./source";

/** Resolve only already-persisted managed-history evidence for preview. @internal */
export async function observeManagedHistoryPolicy(input: {
  readonly projection: ManagedHistoryProjection;
  readonly messages: readonly Message[];
  readonly provider: string;
  readonly model: string;
  readonly max: number;
}): Promise<{
  readonly policy?: ResolvedRepresentationPolicy;
  readonly warnings: readonly RequestWarning[];
}> {
  const split = splitManagedHistory(
    input.messages,
    input.projection.options.recent,
    input.max,
  );
  if (split.prefix.length === 0) {
    return Object.freeze({ warnings: Object.freeze([]) });
  }
  const summaryModel = modelIdentity(
    input.projection.options.summary.model ?? input.model,
  );
  const artifact = await findHistorySummaryArtifact({
    prefix: split.prefix,
    strategy: input.projection.options.summary.strategy,
    provider: input.provider,
    model: summaryModel,
    providerNative: input.projection.options.providerNative,
  });
  const rungs: ResolvedRepresentationPolicy["rungs"][number][] = [
    {
      kind: "full",
      messages: Object.freeze([...input.messages]),
      available: true,
    },
    artifact
      ? {
          kind: "summary",
          messages: managedSummaryMessages(split, artifact),
          available: true,
          ...(artifact.supportRequestId
            ? { supportRequestId: artifact.supportRequestId }
            : {}),
          ...(artifact.supportRequestIds
            ? { supportRequestIds: artifact.supportRequestIds }
            : {}),
        }
      : { kind: "summary", available: false },
  ];
  if (input.projection.options.onMiss === "recent-only") {
    rungs.push({
      kind: "omitted",
      messages: split.recentOnly,
      available: true,
    });
  }
  return Object.freeze({
    policy: Object.freeze({
      contributor: "history",
      sources: Object.freeze([]),
      fullTexts: Object.freeze([]),
      priority: Number.MAX_SAFE_INTEGER,
      declarationOrder: -1,
      ownedToolNames: Object.freeze([]),
      ownedPolicyIds: Object.freeze([]),
      ownedSkillIds: Object.freeze([]),
      ownedToolMiddleware: Object.freeze([]),
      omissionEdits: Object.freeze([]),
      lowerBoundMessages: split.recentOnly,
      rungs: Object.freeze(rungs),
    }),
    warnings: Object.freeze(
      artifact?.stale
        ? [{
            code: "HISTORY_SUMMARY_STALE",
            message:
              "A valid older-prefix summary is available for preview.",
          }]
        : [],
    ),
  });
}

function modelIdentity(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const value = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof value.modelId === "string") return value.modelId;
    if (typeof value.id === "string") return value.id;
  }
  return String(model);
}
