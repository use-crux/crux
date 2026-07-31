/**
 * Lightweight generation helper contracts compiled from native chat profiles.
 *
 * @module
 */

import type { GenerateObjectFn, GenerateTextFn } from "../../generation/support-types";

/** Bound helper functions generated from the same single-turn provider path. */
export interface NativeChatHelpers<TClient> {
  /** Create a framework-agnostic text generation helper for compaction/scoring APIs. */
  createGenerateTextFn(client: TClient, model: string): GenerateTextFn;
  /**
   * Create a framework-agnostic structured generation helper.
   *
   * The returned function accepts canonical prompt or message input and uses
   * its per-call `options.model` as the only model authority. Native profiles
   * require that value to be a non-empty string and forward it unchanged.
   *
   * @param client - Provider SDK client bound lazily on the first valid call.
   * @returns A structured generation function backed by this native profile.
   * @throws {TypeError} When a call supplies a non-string or blank model.
   */
  createGenerateObjectFn(client: TClient): GenerateObjectFn;
}
