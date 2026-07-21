/** AI SDK-native application of Core's private system-prefix patch. */

import type { SystemMessagePrefixPatch } from "@use-crux/core/adapter";
import { SafetyResultError } from "@use-crux/core/safety";

/**
 * Apply a guarded patch without converting the surrounding AI SDK messages.
 * Untouched native objects, content parts, provider options, and bytes retain
 * their original identities.
 *
 * @internal
 */
export function applyAiSdkSystemMessagePrefixPatch(
  messages: readonly unknown[],
  patch: SystemMessagePrefixPatch,
): unknown[] {
  if (patch.kind === "insert") {
    if (messages.some(isSystemMessage)) throw mismatch();
    return [{ role: "system", content: patch.replacementPrefix }, ...messages];
  }

  const target = messages[patch.targetMessageIndex];
  if (
    !isSystemMessage(target) ||
    typeof target.content !== "string" ||
    (patch.expectedContent !== undefined &&
      target.content !== patch.expectedContent) ||
    !target.content.startsWith(patch.expectedPrefix)
  ) {
    throw mismatch();
  }

  const suffix = target.content.slice(patch.expectedPrefix.length);
  const content = `${patch.replacementPrefix}${suffix}`;
  if (content === target.content) return [...messages];

  const result = [...messages];
  result[patch.targetMessageIndex] = { ...target, content };
  return result;
}

function isSystemMessage(
  value: unknown,
): value is Record<string, unknown> & { readonly role: "system" } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { readonly role?: unknown }).role === "system"
  );
}

function mismatch(): SafetyResultError {
  const problem = "system-message prefix patch target mismatch";
  return new SafetyResultError({
    message: problem,
    policyId: "model-ingress",
    boundary: "model.instructions",
    problem,
  });
}
