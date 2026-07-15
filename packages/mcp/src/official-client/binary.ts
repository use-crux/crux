/** Fixed v1 decoded-byte limit for each MCP binary content part. */
export const MAX_MCP_BINARY_PART_BYTES = 20 * 1024 * 1024;

/** Validate binary candidates before the protocol schema scans large strings. */
export function assertMcpResultBinaryParts(value: unknown): void {
  if (!isRecord(value)) return;
  const content = Reflect.get(value, "content");
  if (!Array.isArray(content)) return;
  content.forEach((part, index) => {
    if (!isRecord(part)) return;
    const type = Reflect.get(part, "type");
    if (type === "image" || type === "audio") {
      const data = Reflect.get(part, "data");
      if (typeof data === "string") assertMcpBinaryPart(data, index, type);
      return;
    }
    if (type !== "resource") return;
    const resource = Reflect.get(part, "resource");
    if (!isRecord(resource)) return;
    const blob = Reflect.get(resource, "blob");
    if (typeof blob === "string") {
      assertMcpBinaryPart(blob, index, "resource");
    }
  });
}

/** Validate one untrusted base64 part without allocating its decoded bytes. */
export function assertMcpBinaryPart(
  value: string,
  contentIndex: number,
  contentType: "image" | "audio" | "resource",
): void {
  if (value.length % 4 !== 0) throwMalformed(contentIndex, contentType);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;
  if (decodedBytes > MAX_MCP_BINARY_PART_BYTES) {
    throw new TypeError(
      `MCP result content[${contentIndex}] (${contentType}) exceeds the ` +
        `20 MiB (${MAX_MCP_BINARY_PART_BYTES} byte) limit.`,
    );
  }
  const dataLength = value.length - padding;
  if (
    (padding === 1 && dataLength % 4 !== 3) ||
    (padding === 2 && dataLength % 4 !== 2)
  ) {
    throwMalformed(contentIndex, contentType);
  }
  for (let index = 0; index < dataLength; index += 1) {
    if (base64Value(value.charCodeAt(index)) < 0) {
      throwMalformed(contentIndex, contentType);
    }
  }
  const trailingValue =
    dataLength === 0 ? 0 : base64Value(value.charCodeAt(dataLength - 1));
  if (
    (padding === 2 && (trailingValue & 0b1111) !== 0) ||
    (padding === 1 && (trailingValue & 0b11) !== 0)
  ) {
    throwMalformed(contentIndex, contentType);
  }
}

function throwMalformed(
  contentIndex: number,
  contentType: "image" | "audio" | "resource",
): never {
  throw new TypeError(
    `MCP result content[${contentIndex}] (${contentType}) contains malformed base64; ` +
      `binary parts have a 20 MiB (${MAX_MCP_BINARY_PART_BYTES} byte) limit.`,
  );
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
