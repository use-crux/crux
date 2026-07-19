/**
 * Provider-neutral handler wrappers for explicit serverless host bindings.
 *
 * @module
 */

import type { CruxHostBinding } from "../../scope/types";
import { runWithDeferInvocation } from "../host";
import type {
  DeferHandlerSettlement,
  DeferInvocationOutcome,
} from "../host-types";
import { createDeferError } from "../errors";
import type { DeferAfterPort, DeferWaitUntilPort } from "./ports";
import { SERVERLESS_DEFER_POLICY } from "./policy";

/** Classification hook shared by serverless host wrappers. */
export type ServerlessDeferClassifyOutcome<T> = (
  settlement: DeferHandlerSettlement<T>,
) => DeferInvocationOutcome;

/** Options for {@link withServerlessDefer}. */
export interface ServerlessDeferWrapOptions<T> {
  /** Explicit provider-neutral binding; platform inference is never used. */
  readonly binding: CruxHostBinding;
  /** Map handler settlement to a logical scope outcome synchronously. */
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
}

/** Wrap a handler in an explicitly supplied host binding. */
export function withServerlessDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: ServerlessDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  return wrapWithBinding(handler, options.binding, options.classifyOutcome);
}

/** Options for {@link withWaitUntilDefer}. */
export interface WaitUntilDeferWrapOptions<T> {
  /** Platform retention hook, such as Vercel or Workers `waitUntil`. */
  readonly waitUntil: DeferWaitUntilPort;
  /** Map handler settlement to a logical scope outcome synchronously. */
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
  /** Whether named deferred work may finalize before the response. */
  readonly durableFinalization?: boolean;
  /** Whether inline deferred callbacks may register. Defaults to `true`. */
  readonly supportsInline?: boolean;
}

/** Wrap a handler with handler-returned `waitUntil` retention. */
export function withWaitUntilDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: WaitUntilDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  assertWaitUntilPort(options.waitUntil);
  return wrapWithBinding(
    handler,
    createBinding({
      kind: "wait-until",
      retain: (work) => options.waitUntil(work()),
      durableFinalization: options.durableFinalization ?? false,
      supportsInline: options.supportsInline ?? true,
    }),
    options.classifyOutcome,
  );
}

/** Options for {@link withAfterDefer}. */
export interface AfterDeferWrapOptions<T> {
  /** Platform post-response scheduler, such as Next.js `after`. */
  readonly after: DeferAfterPort;
  /** Map handler settlement to a logical scope outcome synchronously. */
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
  /** Whether named deferred work may finalize before the response. */
  readonly durableFinalization?: boolean;
  /** Whether inline deferred callbacks may register. Defaults to `true`. */
  readonly supportsInline?: boolean;
}

/** Wrap a handler with response-finished `after` retention. */
export function withAfterDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: AfterDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  assertAfterPort(options.after);
  return wrapWithBinding(
    handler,
    createBinding({
      kind: "after",
      retain: (work) => options.after(work),
      durableFinalization: options.durableFinalization ?? false,
      supportsInline: options.supportsInline ?? true,
    }),
    options.classifyOutcome,
  );
}

/** Well-known named-only hosts used for remediation copy. */
export type NamedOnlyDeferHostKind = "lambda" | "convex" | "generic";

/** Options for {@link withNamedOnlyDefer}. */
export interface NamedOnlyDeferWrapOptions {
  /** Host label reserved for diagnostics. Defaults to `generic`. */
  readonly host?: NamedOnlyDeferHostKind;
  /** Whether named work may finalize before handler return. Defaults to `true`. */
  readonly durableFinalization?: boolean;
}

/** Wrap a handler for a host that accepts only named Runtime work. */
export function withNamedOnlyDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: NamedOnlyDeferWrapOptions = {},
): (...args: TArgs) => Promise<Awaited<TResult>> {
  return wrapWithBinding(
    handler,
    createBinding({
      kind: options.host ?? "generic",
      retain: (work) => {
        void work();
      },
      durableFinalization: options.durableFinalization ?? true,
      supportsInline: false,
    }),
  );
}

function wrapWithBinding<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  binding: CruxHostBinding,
  classifyOutcome?: ServerlessDeferClassifyOutcome<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  return (...args: TArgs) =>
    runWithDeferInvocation(() => handler(...args), {
      binding,
      classifyOutcome:
        classifyOutcome ?? defaultClassifyOutcome<Awaited<TResult>>,
    });
}

function createBinding(
  input: Readonly<{
    kind: string;
    retain: CruxHostBinding["retain"];
    durableFinalization: boolean;
    supportsInline: boolean;
  }>,
): CruxHostBinding {
  return Object.freeze({
    ...input,
    invocationScope: false,
    limits: SERVERLESS_DEFER_POLICY,
  } satisfies CruxHostBinding);
}

function assertAfterPort(after: unknown): asserts after is DeferAfterPort {
  if (typeof after === "function") return;
  throw createDeferError({
    code: "DEFER_CAPABILITY_MISSING",
    message:
      "Inline defer() requires an explicit after(task) capability such as Next.js after() from next/server. Upgrade the host or use await defer(target, input) with a configured Runtime.",
  });
}

function assertWaitUntilPort(
  waitUntil: unknown,
): asserts waitUntil is DeferWaitUntilPort {
  if (typeof waitUntil === "function") return;
  throw createDeferError({
    code: "DEFER_CAPABILITY_MISSING",
    message:
      "Inline defer() requires an explicit waitUntil(promise) capability. Pass the platform hook (for example Vercel waitUntil or ctx.waitUntil) — Crux does not infer it from the environment.",
  });
}

function defaultClassifyOutcome<T>(
  settlement: DeferHandlerSettlement<T>,
): DeferInvocationOutcome {
  return settlement.kind === "returned" ? "success" : "error";
}
