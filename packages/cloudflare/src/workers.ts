import { CruxDeferError, type CruxHostBinding } from "@use-crux/core";

/** Structural Worker execution context required for retained work. */
export interface WorkersExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Options for a per-invocation Workers host binding. */
export interface WorkersHostBindingOptions {
  readonly ctx?: WorkersExecutionContext;
}

/** Bind ambient invocation retention to `ExecutionContext.waitUntil()`. */
export function workers(
  options: WorkersHostBindingOptions = {},
): CruxHostBinding {
  return Object.freeze({
    kind: "workers",
    invocationScope: true,
    supportsInline: true,
    durableFinalization: false,
    retain(work): void {
      if (!options.ctx) throw missingWorkersContext();
      options.ctx.waitUntil(work());
    },
  } satisfies CruxHostBinding);
}

function missingWorkersContext(): CruxDeferError {
  return new CruxDeferError({
    code: "DEFER_CAPABILITY_MISSING",
    message:
      "Cloudflare Workers retention requires an ExecutionContext. Pass workers({ ctx }) or use the @use-crux/cloudflare withCrux wrapper.",
  });
}
