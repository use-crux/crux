/**
 * Internal split resolution used by {@link resolveModel}.
 *
 * Split selection is isolated here so the main resolver stays focused on
 * dispatch and cascade handling.
 *
 * @module
 * @internal
 */

import type { Deadline } from "../generation/timeout";
import { observe } from "../observability";
import {
  emitRoutingReceiptReport,
  routingSpanAttributes,
} from "./observability";
import type { SplitModel } from "./split";
import {
  createRoutingReceipt,
  prependRoutingStep,
  routingCostFromMeta,
  withRoutingReceipt,
  type RoutableResult,
  type SplitRoutingStep,
} from "./receipt";

/** Arguments for resolving a split wrapper inside the routing resolver. */
export interface ResolveSplitArgs<M, R> {
  /** Split wrapper to execute. */
  readonly split: SplitModel<Record<string, { model: M; weight: number }>>;
  /** Prompt input for seed callbacks and nested wrappers. */
  readonly input: unknown;
  /** Whole routed-call deadline shared by every nested attempt. */
  readonly deadline: Deadline;
  /** Current execution mode. */
  readonly mode?: "generate" | "stream";
  /** Stream first-token timeout budget inherited from the call site. */
  readonly firstTokenMs?: number;
  /** Call-site routing context. */
  readonly context?: unknown;
  /** Optional route override from the call site. */
  readonly forcedRoute?: string;
  /** Emit the canonical receipt artifact for an outermost split. */
  readonly emitReport?: boolean;
  /** Resolve the selected route model through the top-level resolver. */
  readonly resolveCandidate: (
    model: M,
    options: {
      readonly deadline: Deadline;
      readonly mode?: "generate" | "stream";
      readonly firstTokenMs?: number;
      readonly context?: unknown;
      readonly forcedRoute?: string;
      readonly emitReport?: boolean;
    },
  ) => Promise<RoutableResult<R>>;
  /** Return a human-readable id for raw models and nested wrappers. */
  readonly describeModel: (model: M) => string;
}

/** Resolve a weighted split wrapper to the selected route result. */
export async function resolveSplit<M, R>({
  split,
  input,
  deadline,
  mode,
  firstTokenMs,
  context,
  forcedRoute,
  emitReport = true,
  resolveCandidate,
  describeModel,
}: ResolveSplitArgs<M, R>): Promise<RoutableResult<R>> {
  const { config } = split;
  const routes = config.routes;
  const routeKeys = Object.keys(routes);
  const span = observe.openSpan({
    name: "split.resolve",
    primitive: "routing.split",
    implicitRun: false,
    attributes: {
      ...routingSpanAttributes("split", deadline),
      routeCount: routeKeys.length,
      ...(config.id ? { routingId: config.id } : {}),
      ...(config.description ? { routingDescription: config.description } : {}),
      overridden: forcedRoute !== undefined,
    },
  });

  try {
    return await span.withContext(async () => {
      const seed = config.seed({
        input: input as never,
        context: asRoutingContext(context),
      });
      const seedHash = fnv1a(seed);
      const route = selectSplitRoute(routes, seedHash, forcedRoute);
      const selected = routes[route];
      const selectedModelId = describeModel(selected.model);

      observe.event({
        name: "split.selected",
        attributes: {
          route,
          seedHash,
          selectedModel: selectedModelId,
          overridden: forcedRoute !== undefined,
          ...(config.id ? { routingId: config.id } : {}),
        },
      });

      const result = await resolveCandidate(selected.model, {
        deadline,
        mode,
        firstTokenMs,
        context,
        forcedRoute: undefined,
        emitReport: false,
      });
      const splitStep: SplitRoutingStep = {
        kind: "split",
        ...(config.id ? { id: config.id } : {}),
        route,
        seed,
      };
      const routing =
        result.routing !== undefined
          ? prependRoutingStep(splitStep, result.routing)
          : createRoutingReceipt(
              selectedModelId,
              routingCostFromMeta(result._meta),
              [splitStep],
            );
      const routedResult = withRoutingReceipt(result, routing);
      if (emitReport) {
        emitRoutingReceiptReport(
          span.spanId,
          "routing.split",
          "split",
          routing,
        );
      }

      span.end({
        attributes: {
          route,
          seedHash,
          selectedModel: selectedModelId,
          routeCount: routeKeys.length,
          ...(config.id ? { routingId: config.id } : {}),
        },
      });
      return routedResult;
    });
  } catch (error) {
    span.error(error, {
      routeCount: routeKeys.length,
      ...(config.id ? { routingId: config.id } : {}),
    });
    throw error;
  }
}

function asRoutingContext(value: unknown): object {
  return typeof value === "object" && value !== null ? value : {};
}

function selectSplitRoute<M>(
  routes: Record<string, { model: M; weight: number }>,
  seedHash: number,
  forcedRoute: string | undefined,
): string {
  if (forcedRoute !== undefined && Object.hasOwn(routes, forcedRoute)) {
    return forcedRoute;
  }

  const weighted = Object.entries(routes).filter(([, route]) =>
    Number.isFinite(route.weight) && route.weight > 0,
  );
  if (weighted.length === 0) {
    throw new Error("split() requires at least one route with a positive weight");
  }

  const total = weighted.reduce((sum, [, route]) => sum + route.weight, 0);
  let bucket = seedHash % total;
  for (const [key, route] of weighted) {
    if (bucket < route.weight) return key;
    bucket -= route.weight;
  }
  return weighted[weighted.length - 1][0];
}

function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
