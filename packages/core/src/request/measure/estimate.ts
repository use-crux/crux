/**
 * Fast provider-neutral measurement of complete canonical language requests.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { ProviderMediaHooks } from "../../adapter/native-chat/media-hooks";
import { estimateMessageTokens } from "../../adapter/native-chat/media-tokens";
import { countTokens } from "../../shared/tokenizer";
import {
  tokenBreakdown,
  type RequestTokenBreakdown,
} from "./breakdown";

/** Fast measurement result for one complete canonical request. @internal */
export interface EstimatedRequestMeasurement {
  /** Estimated total input tokens. */
  readonly inputTokens: number;
  /** Redacted contribution-class breakdown. */
  readonly breakdown: RequestTokenBreakdown;
}

/** Estimate all token-bearing fields in one canonical provider request. @internal */
export function estimateRequestTokens<
  TExtra extends Record<string, unknown>,
>(
  args: CallArgs<TExtra>,
  context: {
    readonly provider: string;
    readonly media?: ProviderMediaHooks;
  },
): EstimatedRequestMeasurement {
  const messages = estimateMessageTokens(args.messages, {
    provider: context.provider,
    model: args.model,
    ...(context.media?.estimateTokens
      ? { estimateTokens: context.media.estimateTokens }
      : {}),
  });
  const breakdown = tokenBreakdown([
    {
      contributor: "system",
      tokens: countTokens(args.system ?? ""),
    },
    {
      contributor: "messages",
      tokens: messages.totalTokens,
    },
    {
      contributor: "message-structure",
      tokens: countTokens(safeJson(messageStructure(args.messages))),
    },
    {
      contributor: "tools",
      tokens: countTokens(
        safeJson(
          args.tools?.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
        ),
      ),
    },
    {
      contributor: "output-schema",
      tokens: countTokens(safeJson(args.outputSchema)),
    },
  ]);
  return Object.freeze({
    inputTokens: breakdown.total,
    breakdown,
  });
}

function messageStructure(messages: CallArgs["messages"]): unknown {
  return messages.map((message) => ({
    role: message.role,
    ...(message.metadata ? { metadata: message.metadata } : {}),
    ...(Array.isArray(message.content)
      ? {
          lifecycle: message.content.filter(
            (part) =>
              part.type === "tool-call" || part.type === "reasoning",
          ),
        }
      : {}),
  }));
}

function safeJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === "bigint") return entry.toString();
        if (typeof entry === "function") return undefined;
        return entry;
      }) ?? ""
    );
  } catch {
    return "[unserializable request metadata]";
  }
}
