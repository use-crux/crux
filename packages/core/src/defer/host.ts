/**
 * First-party host adapter SPI for request-scoped deferred work.
 *
 * This is a coordinated, non-semver contract for Crux host packages. It is not
 * a supported application or third-party adapter API.
 *
 * @internal
 * @module
 */

import { createInvocationDeferScope } from "./internal/invocation-scope";
import { runWithDeferRegistration } from "./internal/context";
import { createDeferError } from "./errors";
import type {
  DeferHandlerSettlement,
  DeferHostBoundaryOptions,
} from "./host-types";

export type {
  DeferCompletionClass,
  DeferHandlerSettlement,
  DeferHostBoundaryOptions,
  DeferInvocationOutcome,
  DeferLifetimeCapability,
  DeferLifetimeLimits,
  DeferScheduledTask,
} from "./host-types";

/**
 * Run one handler inside the canonical deferred-work invocation boundary.
 *
 * @internal
 */
export async function runWithDeferInvocation<T>(
  handler: () => T | PromiseLike<T>,
  options: DeferHostBoundaryOptions<Awaited<T>>,
): Promise<Awaited<T>> {
  const scope = createInvocationDeferScope(options.lifetime);
  let settlement: DeferHandlerSettlement<Awaited<T>>;

  try {
    const value = await runWithDeferRegistration(
      { scope, phase: "handler", depth: 0 },
      handler,
    );
    settlement = { kind: "returned", value };
  } catch (error) {
    settlement = { kind: "thrown", error };
  }

  const outcome = options.classifyOutcome(settlement);
  if (isPromiseLike(outcome)) {
    throw new TypeError("Defer classifyOutcome must return synchronously.");
  }
  const { committed } = scope.seal(outcome);
  try {
    await committed;
  } catch (cause) {
    throw createDeferError({
      code: "DEFER_COMMIT_FAILED",
      message:
        "Deferred work could not be committed before the host result boundary.",
      cause,
    });
  }

  if (settlement.kind === "thrown") throw settlement.error;
  return settlement.value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value
  );
}
