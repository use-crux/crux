/**
 * Private, one-shot system-message prefix amendments.
 *
 * The patch carries only sanitized text and exact writeback facts. Resolver
 * provenance never crosses this executor boundary, and applying a patch never
 * reconstructs the surrounding conversation.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import { SafetyResultError } from "../../safety/errors";

/** @internal Private property carrying one pending native-dialect patch. */
export const systemMessagePrefixPatch: unique symbol = Symbol(
  "crux.systemMessagePrefixPatch",
);

/** @internal Exact writeback facts for one active system-message amendment. */
export type SystemMessagePrefixPatch =
  | {
      readonly kind: "replace";
      readonly targetMessageIndex: number;
      readonly expectedPrefix: string;
      readonly expectedContent?: string;
      readonly replacementPrefix: string;
    }
  | {
      readonly kind: "insert";
      readonly targetMessageIndex: 0;
      readonly replacementPrefix: string;
    };

/**
 * Construct a replace or insert patch without exposing its discriminant to
 * lifecycle callers.
 *
 * `expectedPrefix: undefined` means no system message existed and one must be
 * inserted at index zero. An empty expected prefix requires `expectedContent`
 * so writeback cannot succeed through a vacuous prefix match.
 */
export function createSystemMessagePrefixPatch(input: {
  readonly targetMessageIndex: number;
  readonly expectedPrefix: string | undefined;
  readonly expectedContent?: string;
  readonly replacementPrefix: string;
}): SystemMessagePrefixPatch {
  if (input.expectedPrefix === undefined) {
    if (input.targetMessageIndex !== 0) {
      throw mismatch("an inserted system message must target index zero");
    }
    return {
      kind: "insert",
      targetMessageIndex: 0,
      replacementPrefix: input.replacementPrefix,
    };
  }
  if (input.expectedPrefix === "" && input.expectedContent === undefined) {
    throw mismatch("an empty expected prefix requires exact content");
  }
  return {
    kind: "replace",
    targetMessageIndex: input.targetMessageIndex,
    expectedPrefix: input.expectedPrefix,
    ...(input.expectedContent !== undefined
      ? { expectedContent: input.expectedContent }
      : {}),
    replacementPrefix: input.replacementPrefix,
  };
}

/**
 * Apply one prefix patch to canonical Core history.
 *
 * Untouched messages retain identity. Any target, role, content-shape, exact
 * content, or prefix mismatch is policy-terminal and occurs before another
 * provider invocation.
 */
export function applySystemMessagePrefixPatch(
  messages: readonly Message[],
  patch: SystemMessagePrefixPatch,
): Message[] {
  if (patch.kind === "insert") {
    if (messages.some((message) => message.role === "system")) {
      throw mismatch("system-message prefix patch target mismatch");
    }
    return [{ role: "system", content: patch.replacementPrefix }, ...messages];
  }

  const target = messages[patch.targetMessageIndex];
  if (
    target?.role !== "system" ||
    typeof target.content !== "string" ||
    (patch.expectedContent !== undefined &&
      target.content !== patch.expectedContent) ||
    !target.content.startsWith(patch.expectedPrefix)
  ) {
    throw mismatch("system-message prefix patch target mismatch");
  }

  const suffix = target.content.slice(patch.expectedPrefix.length);
  const content = `${patch.replacementPrefix}${suffix}`;
  if (content === target.content) return [...messages];

  const result = [...messages];
  result[patch.targetMessageIndex] = { ...target, content };
  return result;
}

function mismatch(problem: string): SafetyResultError {
  return new SafetyResultError({
    message: problem,
    policyId: "model-ingress",
    boundary: "model.instructions",
    problem,
  });
}
