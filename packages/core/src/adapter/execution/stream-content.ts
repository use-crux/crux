import type { AssistantContentPart } from "../../types/content";

/**
 * Replace provider-buffered text without moving it across mixed content.
 *
 * Streaming guardrails expose one authoritative transformed text value but do
 * not expose a span map back to provider text parts. Repartition that value by
 * each original text slot's code-point proportion; the final slot receives any
 * rounding remainder. If every original slot is empty, divide evenly by slot
 * count. This preserves non-text boundaries without reusing unsafe text.
 */
export function replaceSafeTextContent(
  content: readonly AssistantContentPart[],
  text: string,
): readonly AssistantContentPart[] {
  const textParts = content.filter(
    (part): part is Extract<AssistantContentPart, { type: "text" }> =>
      part.type === "text",
  );
  const replacements = repartitionText(
    text,
    textParts.map((part) => Array.from(part.text).length),
  );
  let textIndex = 0;
  const result = content.map((part): AssistantContentPart => {
    if (part.type !== "text") return part;
    const replacement = { ...part, text: replacements[textIndex] ?? "" };
    textIndex += 1;
    return replacement;
  });
  return textParts.length === 0 && text
    ? [{ type: "text", text }, ...result]
    : result;
}

/** Split safe text by original code-point weights without copying originals. */
function repartitionText(
  text: string,
  originalLengths: readonly number[],
): readonly string[] {
  if (originalLengths.length === 0) return [];
  const codePoints = Array.from(text);
  const originalTotal = originalLengths.reduce((sum, length) => sum + length, 0);
  const weightTotal = originalTotal || originalLengths.length;
  let cumulativeWeight = 0;
  let start = 0;
  return originalLengths.map((length, index) => {
    cumulativeWeight += originalTotal === 0 ? 1 : length;
    const end =
      index === originalLengths.length - 1
        ? codePoints.length
        : Math.floor((codePoints.length * cumulativeWeight) / weightTotal);
    const part = codePoints.slice(start, end).join("");
    start = end;
    return part;
  });
}
