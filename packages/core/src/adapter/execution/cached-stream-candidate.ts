/**
 * Adapter-owned release gate for hydrated stream cache candidates.
 *
 * Streams must accept or reject the complete cached value before a replay
 * handle exists. The evaluator deliberately delegates to the generate
 * candidate seam so text and structured candidates share terminal output
 * guardrails, one authored schema parse, and constraints in the same order.
 *
 * @internal
 * @module
 */

import type { CachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import type { CachedReleaseSeal } from "../../runtime/internal/cached-release-seal";
import type { Message } from "../../generation/messages";
import type { TraceMeta } from "../../generation/types";
import type { Safety } from "../../safety/session";
import type { AssistantContentPart } from "../../types/content";
import {
  createCachedGenerateCandidateFinalizer,
  type CachedGenerateCandidateOptions,
} from "./cached-generate-candidate";
import {
  createAssistantMessage,
  replaceFinalAssistant,
  streamCompletionContent,
} from "./stream-completion-assembly";

/** Inputs needed to evaluate one cached stream candidate before replay. */
export type CachedStreamCandidateOptions = CachedGenerateCandidateOptions;

/**
 * Create the eager finalizer for a cached stream candidate.
 *
 * @param options - Current call policies and structured-output context.
 * @returns A finalizer that accepts canonical output or rejects the cache hit.
 */
export function createCachedStreamCandidateFinalizer(
  options: CachedStreamCandidateOptions,
): CachedCandidateFinalizer {
  return createCachedGenerateCandidateFinalizer(options);
}

interface CachedStreamMeta extends TraceMeta {
  readonly text?: string;
  readonly content?: readonly AssistantContentPart[];
  readonly messages?: readonly Message[];
  readonly object?: unknown;
}

/**
 * Assemble completion bookkeeping for an already accepted cache replay.
 *
 * @param options - Current session, replay metadata, transcript, and seal.
 * @returns Completion facts without opening another terminal release gate.
 */
export function assembleCachedStreamCompletion(options: {
  readonly safety: Safety;
  readonly meta: CachedStreamMeta | undefined;
  readonly messages: readonly Message[];
  readonly release: CachedReleaseSeal;
}): CachedStreamMeta {
  const content = streamCompletionContent(options.meta, options.release.text);
  const messages = options.meta?.messages
    ? replaceFinalAssistant(
        options.meta.messages,
        content,
        options.meta.toolCalls,
      )
    : [
        ...options.messages,
        createAssistantMessage(content, options.meta?.toolCalls),
      ];
  const result = {
    ...options.meta,
    text: options.release.text,
    content,
    messages,
    ...(options.release.resultKind === "object"
      ? { object: options.release.object }
      : {}),
  };
  return options.safety.enabled ? options.safety.stamp(result) : result;
}
