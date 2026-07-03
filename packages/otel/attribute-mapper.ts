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
} from "./attributes";
import {
  GEN_AI_CLIENT_OPERATION_DURATION,
  GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND,
  GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SERVER_TIME_TO_FIRST_TOKEN,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
} from "./semconv";
import type { TraceAttributeValue } from "./types";

export type OtelAttributeValue = TraceAttributeValue;
export type OtelAttributes = Record<string, OtelAttributeValue>;

const MAX_JSON_ATTRIBUTE_LENGTH = 8192

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
    const normalized = attributeValue(normalizedKey, value);
    const normalizedValue = normalized.value;
    if (normalizedValue !== undefined) {
      result[normalizedKey] = normalizedValue;
    }
    if (normalized.truncated) {
      result["crux.truncated"] = true;
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
      return GEN_AI_PROVIDER_NAME;
    case "model":
      return GEN_AI_REQUEST_MODEL;
    case "actualModelId":
      return GEN_AI_RESPONSE_MODEL;
    case "finishReason":
      return GEN_AI_RESPONSE_FINISH_REASONS;
    case "gen.duration_ms":
      return GEN_AI_CLIENT_OPERATION_DURATION;
    case "gen.time_to_first_token_ms":
    case "ttftMs":
      return GEN_AI_SERVER_TIME_TO_FIRST_TOKEN;
    case "gen.output_tokens_per_second":
    case "tokensPerSecond":
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

function attributeValue(
  key: string,
  value: unknown,
): { readonly value?: OtelAttributeValue; readonly truncated?: boolean } {
  if (key === GEN_AI_RESPONSE_FINISH_REASONS) {
    return { value: finishReasonsValue(value) }
  }
  if (key === GEN_AI_CLIENT_OPERATION_DURATION || key === GEN_AI_SERVER_TIME_TO_FIRST_TOKEN) {
    return typeof value === "number" && Number.isFinite(value) ? { value: value / 1000 } : {}
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return { value };
  if (Array.isArray(value)) {
    return primitiveArrayValue(value)
  }
  if (value && typeof value === "object") {
    return jsonAttributeValue(value)
  }
  return {};
}

function finishReasonsValue(value: unknown): readonly string[] | undefined {
  if (typeof value === "string" && value.length > 0) return [value]
  if (Array.isArray(value)) {
    const reasons = value.filter((item): item is string => typeof item === "string" && item.length > 0)
    return reasons.length > 0 ? reasons : undefined
  }
  return undefined
}

function primitiveArrayValue(
  values: readonly unknown[],
): { readonly value?: OtelAttributeValue; readonly truncated?: boolean } {
  if (values.length === 0) return { value: [] }
  if (values.every((item): item is string => typeof item === "string")) return { value: values }
  if (values.every((item): item is number => typeof item === "number" && Number.isFinite(item))) return { value: values }
  if (values.every((item): item is boolean => typeof item === "boolean")) return { value: values }
  return jsonAttributeValue(values)
}

function jsonAttributeValue(value: unknown): { readonly value: string; readonly truncated?: boolean } {
  const raw = safeJsonString(value)
  if (raw.length <= MAX_JSON_ATTRIBUTE_LENGTH) return { value: raw }
  return { value: raw.slice(0, MAX_JSON_ATTRIBUTE_LENGTH), truncated: true }
}

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}
