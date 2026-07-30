/**
 * WebSocket command ownership for the Runtime Bridge.
 *
 * Exact-preview requests are cancellable and raw JSON duplicate keys are
 * rejected before decoding. Legacy store requests retain their compatible
 * decoder and response envelopes.
 *
 * @module
 */

import {
  bridgeErrorCode,
  bridgeErrorDetails,
  bridgeErrorMessage,
  executeRuntimeBridgeCommand,
} from "./commands";
import {
  BridgeCommandRequestSchema,
  type RuntimeBridgeManifestInput,
  type RuntimeBridgeMessage,
} from "./protocol";
import {
  PromptPreviewCancelSchema,
  ScalarValidStringSchema,
} from "./prompt-preview/protocol";
import { assertNoDuplicateJsonKeys } from "./prompt-preview/validate";

/** Stateful handler that retires response ownership on cancellation/disposal. */
export interface RuntimeBridgeSocketCommandHandler {
  handle(event: unknown): void;
  dispose(): void;
}

/** Create one command handler scoped to a single live WebSocket connection. */
export function createRuntimeBridgeSocketCommandHandler(
  input: RuntimeBridgeManifestInput,
  send: (message: RuntimeBridgeMessage) => void,
): RuntimeBridgeSocketCommandHandler {
  const inFlight = new Map<string, AbortController>();
  let disposed = false;

  const handleText = async (text: string): Promise<void> => {
    const decoded = decodeIncoming(text);
    if (!decoded || disposed) return;
    if (decoded.type === "invalid-preview") {
      send({
        type: "command.error",
        commandId: decoded.commandId,
        error: {
          code: "invalid_request",
          message: "Exact-preview request is invalid.",
        },
      });
      return;
    }
    if (decoded.type === "command.cancel") {
      const controller = inFlight.get(decoded.commandId);
      inFlight.delete(decoded.commandId);
      controller?.abort(decoded.reason);
      return;
    }

    const controller =
      decoded.command === "prompt.previewExact"
        ? new AbortController()
        : undefined;
    if (controller) inFlight.set(decoded.commandId, controller);
    try {
      const result = await executeRuntimeBridgeCommand(input, decoded, {
        signal: controller?.signal,
      });
      if (disposed || controller?.signal.aborted) return;
      send({
        type: "command.result",
        commandId: decoded.commandId,
        result,
      });
    } catch (error) {
      if (disposed || controller?.signal.aborted) return;
      send({
        type: "command.error",
        commandId: decoded.commandId,
        error: {
          code: bridgeErrorCode(error),
          message: bridgeErrorMessage(error),
          details: bridgeErrorDetails(error),
        },
      });
    } finally {
      if (controller && inFlight.get(decoded.commandId) === controller) {
        inFlight.delete(decoded.commandId);
      }
    }
  };

  return {
    handle(event) {
      const data = readMessageData(event);
      if (typeof data === "string") void handleText(data);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    },
  };
}

function decodeIncoming(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
    if (isPreviewWireValue(value)) {
      assertNoDuplicateJsonKeys(text);
    }
  } catch {
    return invalidPreview(value);
  }
  const cancelled = PromptPreviewCancelSchema.safeParse(value);
  if (cancelled.success) return cancelled.data;
  const request = BridgeCommandRequestSchema.safeParse(value);
  if (request.success) return request.data;
  return isPreviewWireValue(value) ? invalidPreview(value) : undefined;
}

function invalidPreview(value: unknown) {
  if (!isPreviewWireValue(value)) return undefined;
  const candidate =
    typeof value === "object" && value !== null && "commandId" in value
      ? value.commandId
      : undefined;
  const parsed = ScalarValidStringSchema.min(1).max(128).safeParse(candidate);
  const commandId = parsed.success ? parsed.data : "invalid_request";
  return { type: "invalid-preview" as const, commandId };
}

function isPreviewWireValue(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { type?: unknown; command?: unknown };
  return (
    record.type === "command.cancel" || record.command === "prompt.previewExact"
  );
}

function readMessageData(event: unknown): unknown {
  if (event && typeof event === "object" && "data" in event) {
    return (event as { data: unknown }).data;
  }
  return undefined;
}
