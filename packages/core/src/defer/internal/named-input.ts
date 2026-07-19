/** Shared acceptance rules for durable and captured named defer inputs. */

import type { JsonValue } from "../../storage";
import {
  assertRuntimeJsonValue,
  cloneRuntimeJsonValue,
} from "../../runtime/engine/json-value";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import { createDeferError } from "../errors";

/** Validate and snapshot named input before either capture or Runtime staging. */
export function snapshotNamedDeferInput(
  target: RuntimeTaskTarget,
  input: unknown,
): JsonValue {
  if (input === undefined) {
    throw createDeferError({
      code: "DEFER_TARGET_INPUT_REQUIRED",
      message: `Named defer target \`${target.name}\` requires a JSON input argument.`,
    });
  }
  assertRuntimeJsonValue(input, "deferred target input");
  return cloneRuntimeJsonValue(input, "deferred target input");
}

/** Create a process-independent identity for captured, non-durable work. */
export function createCapturedDeferWorkId(): string {
  return `captured:${createUuid()}`;
}

function createUuid(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
