/**
 * Stateless causal-group-safe recent-history projection.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import { messageText } from "../../content";
import { countTokens } from "../../shared/tokenizer";
import { RequestCompositionError } from "../errors";
import type { RequestWarning } from "../receipt/adaptations";
import { causalMessageGroups } from "./causal-groups";
import {
  type HistorySource,
  type RecentHistoryOptions,
  type RecentHistoryProjection,
} from "./source";

/** Public factory surface for request history policies. */
export interface HistoryFactory {
  /**
   * Select the newest causal-group-safe suffix of a complete transcript.
   *
   * This policy is stateless: it never calls a model, writes Storage, captures
   * a transcript, or schedules work. Complete causal groups can make either
   * limit soft.
   *
   * @param limit - Message cap, or message/token caps.
   * @returns An inert entry for a prompt's `use` array.
   *
   * @example
   * ```ts
   * const reply = prompt({
   *   use: [history.recent({ messages: 20, tokens: 12_000 })],
   *   prompt: "Reply to the conversation.",
   * })
   * ```
   */
  recent(
    limit?: number | Readonly<RecentHistoryOptions>,
  ): RecentHistoryProjection;
}

/** Create provider-neutral history policies for prompt composition. */
export const history: HistoryFactory = Object.freeze({
  recent(
    limit: number | Readonly<RecentHistoryOptions> = 20,
  ): RecentHistoryProjection {
    const limits =
      typeof limit === "number" ? { messages: limit } : { ...limit };
    validateLimit("messages", limits.messages);
    validateLimit("tokens", limits.tokens);
    if (limits.messages === undefined && limits.tokens === undefined) {
      throw new TypeError(
        "history.recent() requires a messages or tokens limit.",
      );
    }
    return Object.freeze({
      _tag: "HistoryRecent" as const,
      limits: Object.freeze(limits),
    });
  },
});

/** Apply one recent-history policy to caller-owned canonical messages. @internal */
export function projectRecentHistory(
  source: HistorySource,
  projection: RecentHistoryProjection,
): {
  readonly messages: Message[];
  readonly warnings: readonly RequestWarning[];
} {
  const { prefix, groups } = causalMessageGroups(source.messages);
  const selected: Message[][] = [];
  let messageCount = 0;
  let tokenCount = 0;
  const messageLimit = projection.limits.messages;
  const tokenLimit = projection.limits.tokens;
  let overflow = false;
  let boundaryAdjusted = false;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const nextCount = messageCount + group.messages.length;
    const groupTokens = group.messages.reduce(
      (sum, message) => sum + countTokens(messageText(message)),
      0,
    );
    const nextTokens = tokenCount + groupTokens;
    const exceeds =
      (messageLimit !== undefined && nextCount > messageLimit) ||
      (tokenLimit !== undefined && nextTokens > tokenLimit);
    if (
      selected.length > 0 &&
      exceeds
    ) {
      boundaryAdjusted = true;
      break;
    }
    if (selected.length === 0 && exceeds) overflow = true;
    selected.unshift([...group.messages]);
    messageCount = nextCount;
    tokenCount = nextTokens;
    if (
      (messageLimit !== undefined && messageCount >= messageLimit) ||
      (tokenLimit !== undefined && tokenCount >= tokenLimit)
    ) {
      break;
    }
  }

  const warnings: RequestWarning[] = [];
  if (overflow) {
    warnings.push(
      Object.freeze({
        code: "HISTORY_CAP_OVERFLOW",
        message:
          "The newest indivisible history group exceeds a configured soft cap and was retained whole.",
      }),
    );
  }
  if (boundaryAdjusted) {
    warnings.push(
      Object.freeze({
        code: "HISTORY_CAUSAL_BOUNDARY",
        message:
          "A history cap was adjusted to preserve an indivisible causal group.",
      }),
    );
  }
  return Object.freeze({
    messages: [
      ...prefix,
      ...selected.flat(),
      ...(source.mode === "automatic" ? (source.current ?? []) : []),
    ],
    warnings: Object.freeze(warnings),
  });
}

/** Create an actionable invalid-composition failure for resolved history ownership. @internal */
export function invalidHistoryComposition(
  message: string,
): RequestCompositionError {
  const requestId = "request_history_composition";
  return new RequestCompositionError(
    "INVALID_COMPOSITION",
    message,
    [
      {
        id: `${requestId}:history`,
        code: "INVALID_HISTORY_COMPOSITION",
        contributor: "history",
        message,
      },
    ],
    requestId,
  );
}

function validateLimit(
  name: keyof RecentHistoryOptions,
  value: number | undefined,
): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new TypeError(
      `history.recent() ${name} must be a positive safe integer.`,
    );
  }
}
