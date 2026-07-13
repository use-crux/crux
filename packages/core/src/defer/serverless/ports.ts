/**
 * Injected host ports for provider-neutral serverless deferred work.
 *
 * Core never imports Next, Vercel, or Cloudflare. Adapters pass the platform
 * function they already hold.
 *
 * @module
 */

/**
 * Retain work after the handler returns (may overlap streaming body delivery).
 *
 * Matches Vercel `waitUntil` and Cloudflare `ExecutionContext.waitUntil`.
 */
export type DeferWaitUntilPort = (promise: Promise<void>) => void;

/**
 * Schedule work after the response has finished.
 *
 * Matches Next.js `after()` from `next/server` (Promise, not bare PromiseLike).
 */
export type DeferAfterPort = (task: () => void | Promise<void>) => void;
