/**
 * First-party host adapter SPI for request-scoped deferred work.
 *
 * This is a coordinated, non-semver contract for Crux host packages. It is not
 * a supported application or third-party adapter API.
 *
 * @internal
 * @module
 */

import { runScope } from "../scope/kernel";
import {
  createScopeDeferController,
  type ScopeDeferController,
} from "./internal/invocation-scope";
import { createInvocationDeferServices } from "./internal/invocation-services";
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
  let controller: ScopeDeferController | undefined;
  let classification: OutcomeClassification | undefined;

  const settlement = await runScope(
    { kind: "invocation" },
    {
      classifyOutcome: () => {
        if (!classification) {
          throw new TypeError(
            "Defer classifyOutcome did not complete synchronously.",
          );
        }
        if (classification.kind === "error") throw classification.error;
        return classification.outcome;
      },
    },
    async (scope): Promise<DeferHandlerSettlement<Awaited<T>>> => {
      const services = createInvocationDeferServices(scope, options.lifetime);
      controller = createScopeDeferController(scope, services);
      let handlerSettlement: DeferHandlerSettlement<Awaited<T>>;
      try {
        const value = await runWithDeferRegistration(
          { scope: controller, phase: "handler", depth: 0 },
          handler,
        );
        handlerSettlement = { kind: "returned", value };
      } catch (error) {
        handlerSettlement = { kind: "thrown", error };
      }

      try {
        const outcome = options.classifyOutcome(handlerSettlement);
        if (isPromiseLike(outcome)) {
          classification = {
            kind: "error",
            error: new TypeError(
              "Defer classifyOutcome must return synchronously.",
            ),
          };
        } else {
          classification = { kind: "outcome", outcome };
        }
      } catch (error) {
        classification = { kind: "error", error };
      }
      return handlerSettlement;
    },
  );

  const { committed } = requireController(controller).getDrainHandle();
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

type OutcomeClassification =
  | {
      readonly kind: "outcome";
      readonly outcome: ReturnType<
        DeferHostBoundaryOptions<unknown>["classifyOutcome"]
      >;
    }
  | { readonly kind: "error"; readonly error: unknown };

function requireController(
  controller: ScopeDeferController | undefined,
): ScopeDeferController {
  if (controller) return controller;
  throw new TypeError("The defer invocation controller was not initialized.");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value
  );
}
