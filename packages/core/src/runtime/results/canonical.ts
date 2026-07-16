import type { JsonValue } from "../../storage";
import { sha256Hex } from "../../content/sha256";
import { assertRuntimeJsonValue } from "../engine/json-value";
import { createRuntimeError } from "../engine/errors";
import { RUNTIME_RESULT_MAX_BYTES } from "./types";

/** Canonical UTF-8 JSON representation used by every Runtime result adapter. */
export function canonicalRuntimeResult(payload: JsonValue): {
  readonly bytes: Uint8Array;
  readonly json: string;
  readonly sha256: string;
} {
  assertRuntimeJsonValue(payload, "result payload");
  const json = serialize(payload);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > RUNTIME_RESULT_MAX_BYTES) {
    throw createRuntimeError({
      code: "EVAL_RESULT_TOO_LARGE",
      whatFailed:
        "The Runtime Eval result exceeds the 1 MiB canonical JSON limit.",
      why: `The canonical UTF-8 payload is ${bytes.byteLength} bytes.`,
      whatStillWorks:
        "The target can still complete after returning a smaller normalized result.",
      nextStep:
        "Store large content as a durable Crux asset and return only its bounded asset reference.",
    });
  }
  return Object.freeze({ bytes, json, sha256: sha256Hex(bytes) });
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue | undefined };
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(record[key]!)}`)
    .join(",")}}`;
}
