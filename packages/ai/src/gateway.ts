/**
 * `SdkGateway` — the seam between `@use-crux/ai` and the `ai` package.
 *
 * This is the ONLY module in `@use-crux/ai` that calls AI SDK runtime
 * functions. Everything else (the executor, mapping code, metrics)
 * receives a gateway, which is what makes the whole adapter testable
 * without `vi.mock('ai')`:
 *
 * - production wiring is {@link liveSdkGateway} — identity passthrough;
 * - tests inject a scripted gateway via `createCruxAi({ gateway })`, or
 *   run `MockLanguageModelV3` through the LIVE gateway when real loop
 *   mechanics (`stopWhen`, `prepareStep`, repair) are the thing under test.
 *
 * @module
 */

import { embedMany, generateObject, generateText, rerank, streamObject, streamText } from 'ai'

/**
 * The narrow surface of the `ai` package that `@use-crux/ai` consumes.
 *
 * Signatures mirror the SDK's entry points with arguments forwarded
 * verbatim, so the live implementation is identity wiring and a test
 * double only needs to script results. Args/results are intentionally
 * loose here (`Parameters<typeof fn>[0]`): precise generic typing lives
 * at the public `generate()`/`stream()` boundary, not inside the seam.
 */
export interface SdkGateway {
  /** Mirror of AI SDK `generateText` — the SDK-owned tool loop. */
  generateText(args: Parameters<typeof generateText>[0]): ReturnType<typeof generateText>
  /** Mirror of AI SDK `generateObject` — one structured-output attempt. */
  generateObject(args: Parameters<typeof generateObject>[0]): ReturnType<typeof generateObject>
  /** Mirror of AI SDK `streamText`. */
  streamText(args: Parameters<typeof streamText>[0]): ReturnType<typeof streamText>
  /** Mirror of AI SDK `streamObject`. */
  streamObject(args: Parameters<typeof streamObject>[0]): ReturnType<typeof streamObject>
  /** Mirror of AI SDK `embedMany` (string values). */
  embedMany(args: Parameters<typeof embedMany>[0]): ReturnType<typeof embedMany>
  /** Mirror of AI SDK `rerank`. */
  rerank(args: Parameters<typeof rerank>[0]): ReturnType<typeof rerank>
}

/**
 * The production gateway: each method forwards to the real AI SDK
 * function. Constructed once per `createCruxAi()` instance.
 */
export function liveSdkGateway(): SdkGateway {
  return {
    generateText: (args) => generateText(args),
    generateObject: (args) => generateObject(args),
    streamText: (args) => streamText(args),
    streamObject: (args) => streamObject(args),
    embedMany: (args) => embedMany(args),
    rerank: (args) => rerank(args),
  }
}
