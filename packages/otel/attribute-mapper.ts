/**
 * Attribute normalization for Crux graph records exported as OTel spans.
 *
 * The record subscriber owns lifecycle mapping; this module owns the key/value
 * projection so resource-specific privacy rules stay isolated and testable.
 *
 * @module
 */

import { PAYLOAD_ATTRIBUTE_KEYS } from "@use-crux/core/observability";
import {
  CRUX_COST,
  CRUX_PROMPT_ID,
  CRUX_TOOL_CALL_ID,
  CRUX_TOOL_MODEL_OUTPUT_SIZE,
  CRUX_TOOL_MODEL_OUTPUT_TYPE,
  CRUX_TOOL_NAME,
  CRUX_TOOL_OUTPUT_SIZE,
  CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE,
  CRUX_WORKSPACE_ID,
  CRUX_WORKSPACE_MIME_TYPE,
  CRUX_WORKSPACE_MOUNT,
  CRUX_WORKSPACE_OPERATION,
  CRUX_WORKSPACE_PATH_HASH,
  CRUX_WORKSPACE_SIZE,
  CRUX_WORKSPACE_STATUS,
  GEN_AI_CLIENT_DURATION_MS,
  GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND,
  GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS,
  GEN_AI_CLIENT_TIME_TO_FIRST_TOKEN_MS,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
} from "./attributes";

export type OtelAttributeValue = string | number | boolean;
export type OtelAttributes = Record<string, OtelAttributeValue>;

/** Convert Crux metric fields into OTel-safe span attributes. */
export function metricsFor(
  metrics: Record<string, unknown> | undefined,
): OtelAttributes {
  if (!metrics) return {};
  return attributesFor({
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    totalTokens: metrics.totalTokens,
    costUsd: metrics.costUsd,
    ttftMs: metrics.ttftMs,
    tokensPerSecond: metrics.tokensPerSecond,
    ...metrics,
  });
}

/** Convert arbitrary graph-record attributes into OTel-safe span attributes. */
export function attributesFor(
  attributes: Record<string, unknown> | undefined,
): OtelAttributes {
  if (!attributes) return {};
  const result: OtelAttributes = {};
  const workspaceAttributes = isWorkspaceAttributeSet(attributes);
  for (const [key, value] of Object.entries(attributes)) {
    if (isPayloadAttributeKey(key)) continue;
    const normalizedKey = attributeKeyFor(key, workspaceAttributes);
    if (!normalizedKey) continue;
    const normalizedValue = attributeValue(value);
    if (normalizedValue !== undefined) {
      result[normalizedKey] = normalizedValue;
    }
  }
  return result;
}

function isPayloadAttributeKey(key: string): boolean {
  return (PAYLOAD_ATTRIBUTE_KEYS as readonly string[]).includes(key);
}

/** Workspace records need resource-specific keys and must never export legacy raw paths. */
function isWorkspaceAttributeSet(attributes: Record<string, unknown>): boolean {
  return (
    attributes.primitive === "workspace.operation" ||
    typeof attributes.workspaceId === "string" ||
    typeof attributes.pathHash === "string"
  );
}

function attributeKeyFor(
  key: string,
  workspaceAttributes = false,
): string | undefined {
  if (workspaceAttributes) {
    switch (key) {
      case "workspaceId":
        return CRUX_WORKSPACE_ID;
      case "operation":
        return CRUX_WORKSPACE_OPERATION;
      case "mount":
        return CRUX_WORKSPACE_MOUNT;
      case "mimeType":
        return CRUX_WORKSPACE_MIME_TYPE;
      case "size":
        return CRUX_WORKSPACE_SIZE;
      case "status":
        return CRUX_WORKSPACE_STATUS;
      case "pathHash":
        return CRUX_WORKSPACE_PATH_HASH;
      case "path":
      case "uri":
        return undefined;
    }
  }
  switch (key) {
    case "provider":
      return GEN_AI_SYSTEM;
    case "model":
      return GEN_AI_REQUEST_MODEL;
    case "actualModelId":
      return GEN_AI_RESPONSE_MODEL;
    case "finishReason":
      return GEN_AI_RESPONSE_FINISH_REASONS;
    case "gen.duration_ms":
      return GEN_AI_CLIENT_DURATION_MS;
    case "gen.time_to_first_token_ms":
      return GEN_AI_CLIENT_TIME_TO_FIRST_TOKEN_MS;
    case "gen.output_tokens_per_second":
      return GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND;
    case "gen.time_per_output_chunk_ms":
      return GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS;
    case "inputTokens":
      return GEN_AI_USAGE_INPUT_TOKENS;
    case "outputTokens":
      return GEN_AI_USAGE_OUTPUT_TOKENS;
    case "costUsd":
      return CRUX_COST;
    case "promptId":
      return CRUX_PROMPT_ID;
    case "toolName":
      return CRUX_TOOL_NAME;
    case "toolCallId":
      return CRUX_TOOL_CALL_ID;
    case "modelOutputType":
      return CRUX_TOOL_MODEL_OUTPUT_TYPE;
    case "outputSize":
      return CRUX_TOOL_OUTPUT_SIZE;
    case "modelOutputSize":
      return CRUX_TOOL_MODEL_OUTPUT_SIZE;
    case "tokenSavingsEstimate":
      return CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE;
    case "pathHash":
      return CRUX_WORKSPACE_PATH_HASH;
    default:
      return key.includes(".") ? key : `crux.${key}`;
  }
}

function attributeValue(value: unknown): OtelAttributeValue | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return undefined;
}
