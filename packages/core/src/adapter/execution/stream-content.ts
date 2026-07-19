import type { AssistantContentPart } from "../../types/content";

/** Replace provider text slots in place while preserving every non-text part. */
export function replaceTextSlots(
  content: readonly AssistantContentPart[],
  replacements: readonly string[],
  fallbackText = "",
): readonly AssistantContentPart[] {
  const textSlotCount = content.filter((part) => part.type === "text").length;
  if (textSlotCount !== replacements.length) {
    throw new Error(
      `Stream completion text-slot mismatch: expected ${textSlotCount}, received ${replacements.length}.`,
    );
  }
  let textIndex = 0;
  const result = content.map((part): AssistantContentPart => {
    if (part.type !== "text") return part;
    const text = replacements[textIndex] ?? "";
    textIndex += 1;
    return text === part.text ? part : { ...part, text };
  });
  return textIndex === 0 && fallbackText
    ? [{ type: "text", text: fallbackText }, ...result]
    : result;
}
