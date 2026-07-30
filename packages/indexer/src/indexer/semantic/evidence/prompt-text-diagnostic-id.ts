import { createHash } from "node:crypto";
import type { PromptTextDiagnosticConclusion } from "./prompt-text-diagnostics";

const DIAGNOSTIC_ID_DOMAIN = "crux-prompt-text-diagnostic-v1\0";
const MAX_U32 = 0xffff_ffff;

/**
 * Hashes one normalized conclusion with the PromptText diagnostic V1 stream.
 *
 * Returns `undefined` when any length or numeric component cannot be encoded
 * losslessly as `u32`; callers suppress that diagnostic rather than wrapping.
 *
 * @param conclusion - Compiler-free evidence with exact source identity.
 * @param code - Canonical diagnostic code included in the identity stream.
 * @returns A stable prefixed SHA-256 identity, or `undefined` on overflow.
 */
export function createPromptTextDiagnosticId(
  conclusion: PromptTextDiagnosticConclusion,
  code: string,
): string | undefined {
  const source = conclusion.interpolation.source;
  const path = conclusion.interpolation.path ?? [];
  const parts = [
    encodeUtf8(DIAGNOSTIC_ID_DOMAIN, false),
    encodeUtf8(conclusion.definitionId),
    encodeUtf8(conclusion.sourceRefId),
    encodeUtf8(code),
    encodeUtf8(source.file),
    encodeU32(source.line),
    encodeU32(source.column),
    encodeU32(conclusion.interpolation.index),
    encodeU32(path.length),
    ...path.map(encodeU32),
    encodeUtf8(conclusion.cause.kind),
    ...causePayload(conclusion),
  ];
  if (parts.some((part) => part === undefined)) return undefined;
  const encodedParts = parts.filter(
    (part): part is Buffer => part !== undefined,
  );
  const hash = createHash("sha256");
  for (const part of encodedParts) hash.update(part);
  return `prompt-text:${hash.digest("hex")}`;
}

function causePayload(
  conclusion: PromptTextDiagnosticConclusion,
): readonly (Buffer | undefined)[] {
  switch (conclusion.cause.kind) {
    case "invalid-interpolation":
      return [
        encodeU32(conclusion.cause.runtimeKinds.length),
        ...conclusion.cause.runtimeKinds.map((kind) => encodeUtf8(kind)),
        Buffer.from([conclusion.cause.mdJsonApplicable ? 1 : 0]),
      ];
    case "inline-sequence":
      return [Buffer.from([conclusion.cause.joinableWithComma ? 1 : 0])];
    case "json-serialization":
      return [encodeUtf8("undefined-result")];
  }
}

function encodeUtf8(value: string, lengthPrefix = true): Buffer | undefined {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > MAX_U32) return undefined;
  if (!lengthPrefix) return bytes;
  const length = encodeU32(bytes.length);
  return length ? Buffer.concat([length, bytes]) : undefined;
}

function encodeU32(value: number): Buffer | undefined {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32)
    return undefined;
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
