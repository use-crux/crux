/**
 * Command-aware HTTP decoding and closed error projection for Runtime Bridge.
 *
 * Store requests retain their independent schema. Exact preview alone opts
 * into duplicate-key rejection and its strict, stack-free error union.
 *
 * @module
 */

import { normalizeObservedError } from "@use-crux/core/observability";
import {
  BridgeCommandErrorSchema,
  BridgeCommandRequestSchema,
  PromptPreviewErrorEnvelopeSchema,
  ScalarValidStringSchema,
  assertNoDuplicateJsonKeys,
  bridgeErrorCode,
  bridgeErrorDetails,
  bridgeErrorMessage,
  type BridgeCommandError,
} from "@use-crux/core/runtime-bridge";

/** Decode one command without applying preview-only strictness to store data. */
export async function parseBridgeCommandRequest(
  request: Request,
): Promise<
  | { ok: true; command: ReturnType<typeof BridgeCommandRequestSchema.parse> }
  | { ok: false; error: BridgeCommandError }
> {
  let body: unknown;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : undefined;
    if (isPreviewRequest(body)) assertNoDuplicateJsonKeys(text);
  } catch (error) {
    if (isPreviewRequest(body)) {
      return { ok: false, error: invalidPreviewRequestError(body) };
    }
    return {
      ok: false,
      error: toBridgeCommandError("invalid_request", {
        code: "invalid_json",
        message: `Request body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      }),
    };
  }

  try {
    return { ok: true, command: BridgeCommandRequestSchema.parse(body) };
  } catch (error) {
    if (isPreviewRequest(body)) {
      return { ok: false, error: invalidPreviewRequestError(body) };
    }
    return {
      ok: false,
      error: toBridgeCommandError("invalid_request", {
        code: "invalid_command",
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

/** Project one command failure into the matching store or preview envelope. */
export function toBridgeCommandError(
  commandId: string,
  error: unknown,
): BridgeCommandError {
  const bridgeCode = bridgeErrorCode(error);
  if (isPromptPreviewErrorCode(bridgeCode)) {
    return PromptPreviewErrorEnvelopeSchema.parse({
      type: "command.error",
      commandId,
      error: {
        code: bridgeCode,
        message: bridgeErrorMessage(error),
        details: bridgeErrorDetails(error),
      },
    });
  }
  const explicit = isRecord(error) ? error : undefined;
  const explicitCode =
    typeof explicit?.code === "string" ? explicit.code : undefined;
  const explicitMessage =
    typeof explicit?.message === "string" ? explicit.message : undefined;
  const errorKind = explicitCode ?? "runtime_error";
  const phase = "runtime_bridge.command";
  return BridgeCommandErrorSchema.parse({
    type: "command.error",
    commandId,
    error: {
      code: errorKind,
      message:
        explicitMessage ??
        (error instanceof Error ? error.message : String(error)),
      details: {
        ...normalizeObservedError(error, { phase, errorKind }),
        phase,
        errorKind,
      },
    },
  });
}

function invalidPreviewRequestError(body: unknown): BridgeCommandError {
  const candidate = isRecord(body) ? body.commandId : undefined;
  const parsed = ScalarValidStringSchema.min(1).max(128).safeParse(candidate);
  return PromptPreviewErrorEnvelopeSchema.parse({
    type: "command.error",
    commandId: parsed.success ? parsed.data : "invalid_request",
    error: {
      code: "invalid_request",
      message: "Exact-preview request is invalid.",
    },
  });
}

function isPreviewRequest(value: unknown): boolean {
  return isRecord(value) && value.command === "prompt.previewExact";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPromptPreviewErrorCode(code: string): boolean {
  return [
    "invalid_request",
    "target_unavailable",
    "catalogue_changed",
    "target_retired",
    "input_limit_exceeded",
    "inspection_timeout",
    "inspection_failed",
    "result_limit_exceeded",
    "internal_error",
  ].includes(code);
}
