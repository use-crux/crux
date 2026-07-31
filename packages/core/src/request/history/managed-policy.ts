/**
 * Concrete request policy for managed history.
 *
 * @internal
 * @module
 */

import { messageText } from "../../content";
import type { Message } from "../../generation/messages";
import { countTokens } from "../../shared/tokenizer";
import {
  findHistorySummaryArtifact,
  joinHistorySummaryPreparation,
  prepareHistorySummaryArtifact,
  scheduleHistorySummaryPreparation,
  type GenerateHistorySummary,
  type HistorySummaryArtifact,
} from "../artifacts/lifecycle";
import type { RequestWarning } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import { causalMessageGroups } from "./causal-groups";
import type {
  HistoryOptions,
  ManagedHistoryProjection,
} from "./source";

/** Resolve a managed history policy at one concrete request boundary. @internal */
export async function resolveManagedHistoryPolicy(input: {
  readonly projection: ManagedHistoryProjection;
  readonly messages: readonly Message[];
  readonly provider: string;
  readonly model: string;
  readonly responseModel?: unknown;
  readonly fullInputTokens: number;
  readonly optimizeAt: number;
  readonly max: number;
  readonly generate: GenerateHistorySummary;
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
  const generationModel =
    input.projection.options.summary.model ??
    input.responseModel ??
    input.model;
  const summaryModel = modelIdentity(generationModel);
  const strategy = input.projection.options.summary.strategy;
  const warnings: RequestWarning[] = [];
  let artifact = await findHistorySummaryArtifact({
    prefix: split.prefix,
    strategy,
    provider: input.provider,
    model: summaryModel,
    providerNative: input.projection.options.providerNative,
  });

  if (!artifact && input.fullInputTokens > input.max) {
    const joined = joinHistorySummaryPreparation({
      prefix: split.prefix,
      strategy,
      provider: input.provider,
      model: summaryModel,
      providerNative: input.projection.options.providerNative,
    });
    if (joined) {
      warnings.push({
        code: "HISTORY_SUMMARY_JOINED",
        message: "The request joined identical in-flight summary preparation.",
      });
      try {
        artifact = await joined;
      } catch {
        artifact = undefined;
      }
    } else if (input.projection.options.onMiss === "inline") {
      const preparation = prepareHistorySummaryArtifact({
        prefix: split.prefix,
        strategy,
        provider: input.provider,
        model: summaryModel,
        generationModel,
        providerNative: input.projection.options.providerNative,
        generate: input.generate,
      });
      warnings.push({
        code: preparation.joined
          ? "HISTORY_SUMMARY_JOINED"
          : "HISTORY_SUMMARY_INLINE",
        message: preparation.joined
          ? "The request joined identical in-flight summary preparation."
          : "A required history summary was prepared before provider dispatch.",
      });
      try {
        artifact = await preparation.artifact;
      } catch {
        artifact = undefined;
      }
    }
  } else if (
    input.fullInputTokens > input.optimizeAt &&
    shouldRefresh(split.prefix.length, artifact)
  ) {
    const preparationInput = {
      prefix: split.prefix,
      strategy,
      provider: input.provider,
      model: summaryModel,
      generationModel,
      providerNative: input.projection.options.providerNative,
      generate: input.generate,
    };
    const scheduled =
      scheduleHistorySummaryPreparation(preparationInput);
    warnings.push(scheduled.warning);
    if (!scheduled.retained) {
      try {
        await prepareHistorySummaryArtifact(preparationInput).artifact;
      } catch {
        // The missing summary rung remains unavailable for this call.
      }
    }
  }

  const rungs: ResolvedRepresentationPolicy["rungs"][number][] = [
    {
      kind: "full",
      messages: Object.freeze([...input.messages]),
      available: true,
    },
  ];
  if (artifact) {
    rungs.push({
      kind: "summary",
      messages: managedSummaryMessages(split, artifact),
      available: true,
      ...(artifact.supportRequestId
        ? { supportRequestId: artifact.supportRequestId }
        : {}),
      ...(artifact.supportRequestIds
        ? { supportRequestIds: artifact.supportRequestIds }
        : {}),
    });
    if (artifact.stale) {
      warnings.push({
        code: "HISTORY_SUMMARY_STALE",
        message:
          "A valid older-prefix summary was selected while fresher preparation continues.",
      });
    }
  } else {
    rungs.push({ kind: "summary", available: false });
  }
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
    warnings: Object.freeze(warnings),
  });
}

/** Deterministic causal split shared by execution and preview. @internal */
export interface ManagedHistorySplit {
  readonly leading: readonly Message[];
  readonly prefix: readonly Message[];
  readonly conversational: readonly Message[];
  readonly recentOnly: readonly Message[];
}

/** Split exact history into summary prefix and exact suffix. @internal */
export function splitManagedHistory(
  messages: readonly Message[],
  recent: HistoryOptions["recent"],
  maxInputTokens: number,
): ManagedHistorySplit {
  const { prefix: leading, groups } = causalMessageGroups(messages);
  const limits =
    recent === undefined
      ? { tokens: Math.max(1, Math.floor(maxInputTokens * 0.4)) }
      : typeof recent === "number"
        ? { messages: recent }
        : recent;
  const selected: Message[][] = [];
  let messageCount = 0;
  let tokenCount = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const nextMessages = messageCount + group.messages.length;
    const nextTokens =
      tokenCount +
      group.messages.reduce(
        (sum, message) => sum + countTokens(messageText(message)),
        0,
      );
    const exceeds =
      (limits.messages !== undefined && nextMessages > limits.messages) ||
      (limits.tokens !== undefined && nextTokens > limits.tokens);
    if (selected.length > 0 && exceeds) break;
    selected.unshift([...group.messages]);
    messageCount = nextMessages;
    tokenCount = nextTokens;
  }
  const recentMessages = selected.flat();
  const conversational = groups.flatMap((group) => group.messages);
  const prefixLength = Math.max(
    0,
    conversational.length - recentMessages.length,
  );
  return Object.freeze({
    leading: Object.freeze([...leading]),
    prefix: Object.freeze(conversational.slice(0, prefixLength)),
    conversational: Object.freeze(conversational),
    recentOnly: Object.freeze([...leading, ...recentMessages]),
  });
}

/** Project one persisted summary with its exact suffix. @internal */
export function managedSummaryMessages(
  split: ManagedHistorySplit,
  artifact: HistorySummaryArtifact,
): readonly Message[] {
  return Object.freeze([
    ...split.leading,
    {
      role: "assistant" as const,
      content: `Historical summary:\n${artifact.summary}`,
    },
    ...split.conversational.slice(artifact.identity.prefixLength),
  ]);
}

function shouldRefresh(
  targetPrefixLength: number,
  artifact: HistorySummaryArtifact | undefined,
): boolean {
  if (!artifact) return true;
  const added = targetPrefixLength - artifact.identity.prefixLength;
  return added >= Math.max(4, Math.ceil(artifact.identity.prefixLength * 0.25));
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
