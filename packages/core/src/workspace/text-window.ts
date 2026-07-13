/**
 * UTF-8 byte windowing for workspace text reads.
 *
 * Both stored files and virtual mount sources use this helper so
 * `maxInlineBytes` and `offset` behave consistently across backends.
 *
 * @module
 */

import { byteLength } from "./text-utils";

/** Select a UTF-8-safe byte window from a text payload. */
export function workspaceTextByteWindow(
  content: string,
  maxInlineBytes: number,
  offset: number | undefined,
): {
  readonly content: string;
  readonly offset: number;
  readonly truncated: boolean;
} {
  const size = byteLength(content);
  const safeMax = Math.max(0, Math.floor(maxInlineBytes));
  const start = Math.min(Math.max(0, Math.floor(offset ?? 0)), size);
  if (start === 0 && size <= safeMax) {
    return { content, offset: 0, truncated: false };
  }

  let byteIndex = 0;
  let selected = "";
  let selectedBytes = 0;
  let actualStart = start;
  for (const char of content) {
    const charBytes = byteLength(char);
    const nextByteIndex = byteIndex + charBytes;
    if (nextByteIndex <= start) {
      byteIndex = nextByteIndex;
      continue;
    }
    if (selectedBytes + charBytes > safeMax) break;
    if (selectedBytes === 0) actualStart = byteIndex;
    selected += char;
    selectedBytes += charBytes;
    byteIndex = nextByteIndex;
  }

  return {
    content: selected,
    offset: selected ? actualStart : start,
    truncated: start > 0 || actualStart + selectedBytes < size,
  };
}
