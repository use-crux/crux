/**
 * Model resolution — unwraps router/cascade/fallback wrappers into
 * concrete model calls. Called by adapter packages before generation.
 *
 * @module
 * @internal
 */

import { isRouter } from "./router";
import type { RouterModel } from "./router";
import { isCascade } from "./cascade";
import type {
  CascadeModel,
  CascadeTier,
  CascadeTierDetail,
  CascadeTierEvaluationResult,
} from "./cascade";
import { CascadeExhaustedError, createRoutingStreamError } from "./errors";
import { observe } from "../observability";
import {
  Deadline,
  composeAbortSignals,
  withAbortSignal,
} from "../generation/timeout";
import { isFallback, type FallbackModel } from "../generation/fallback";
import { resolveFallback } from "./resolve-fallback";
import { gateFirstToken } from "./first-token";
import {
  createRoutingReceipt,
  ensureRoutingResult,
  prependRoutingStep,
  routingCostFromMeta,
  withRoutingReceipt,
  type RoutableResult,
  type CascadeRoutingStep,
  type RouterRoutingStep,
} from "./receipt";

/** Options supplied to one concrete model attempt during routing resolution. */
export interface ResolveTryOptions {
  /** Cooperative cancellation signal composed from routing deadlines. */
  readonly signal?: AbortSignal;
}

/** Shared controls for one recursive model resolution. */
export interface ResolveModelOptions {
  /** Current execution mode. Cascade is generate-only, even when nested. */
  readonly mode?: "generate" | "stream";
  /** Preserve a top-level raw model result without adding routing metadata. */
  readonly preserveRawResult?: boolean;
  /** Whole-call deadline inherited from the caller's timeout policy. */
  readonly deadline?: Deadline;
  /** Narrower cancellation signal inherited from a containing wrapper. */
  readonly signal?: AbortSignal;
  /** Stream first-token timeout budget inherited from the call site. */
  readonly firstTokenMs?: number;
}

// ─────────────────────────────────────────────────────────────────
// resolveModel
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve a model (which may be a router, cascade, or raw model) into
 * a concrete generation result. Handles classification, sequential
 * escalation, budget enforcement, and metadata attachment.
 *
 * @param model - Raw model, RouterModel, or CascadeModel
 * @param input - The user input (passed to router classify)
 * @param tryModel - Adapter-specific callback that generates with a single model
 * @param extractModelId - Extracts a string ID from the adapter's model type
 * @returns The generation result with routing metadata attached
 */
export async function resolveModel<M, R>(
  model: M,
  input: Record<string, unknown>,
  tryModel: (model: M, options?: ResolveTryOptions) => Promise<R>,
  extractModelId: (model: M) => string,
  options: ResolveModelOptions = {},
): Promise<RoutableResult<R>> {
  const deadline = options.deadline ?? Deadline.after(undefined);
  const ownsDeadline = options.deadline === undefined;

  try {
    // ── Router ──
    if (isRouter(model)) {
      return await resolveRouter(
        model as unknown as RouterModel<string, M>,
        input,
        tryModel,
        extractModelId,
        { deadline, mode: options.mode, firstTokenMs: options.firstTokenMs },
      );
    }

    // ── Cascade ──
    if (isCascade(model)) {
      if (options.mode === "stream") {
        throw createRoutingStreamError("cascade");
      }
      return await resolveCascade(
        model as unknown as CascadeModel<M>,
        input,
        tryModel,
        extractModelId,
        { deadline, mode: options.mode, firstTokenMs: options.firstTokenMs },
      );
    }

    // ── Fallback ──
    if (isFallback(model)) {
      return await resolveFallback({
        fallback: model as unknown as FallbackModel<M>,
        deadline,
        resolveCandidate: (candidate, attemptOptions) =>
          resolveModel(candidate, input, tryModel, extractModelId, {
            deadline,
            mode: options.mode,
            signal: attemptOptions.signal,
            firstTokenMs: options.firstTokenMs,
          }).then((result) => result),
        describeModel: (candidate) => describeModel(candidate, extractModelId),
      });
    }

    // ── Raw model ──
    const firstTokenController =
      options.mode === "stream" && options.firstTokenMs !== undefined
        ? new AbortController()
        : undefined;
    const attemptSignal = composeAbortSignals(
      deadline.signal,
      options.signal,
      firstTokenController?.signal,
    );
    const result = await withAbortSignal(
      () => tryModel(model, { signal: attemptSignal }),
      attemptSignal,
    );
    const gatedResult = await gateFirstToken(result, {
      firstTokenMs: options.mode === "stream" ? options.firstTokenMs : undefined,
      attemptController: firstTokenController,
    });
    if (options.preserveRawResult) {
      return gatedResult as RoutableResult<R>;
    }
    return ensureRoutingResult(gatedResult);
  } finally {
    if (ownsDeadline) deadline.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────
// Router resolution
// ─────────────────────────────────────────────────────────────────

async function resolveRouter<M, R>(
  routerModel: RouterModel<string, M>,
  input: Record<string, unknown>,
  tryModel: (model: M, options?: ResolveTryOptions) => Promise<R>,
  extractModelId: (model: M) => string,
  options: {
    deadline: Deadline;
    mode?: "generate" | "stream";
    firstTokenMs?: number;
  },
): Promise<RoutableResult<R>> {
  const { config, _forcedRoute, _hints } = routerModel;
  const availableRoutes = Object.keys(config.routes);
  const span = observe.openSpan({
    name: "router.resolve",
    primitive: "routing.router",
    implicitRun: false,
    attributes: {
      routeCount: availableRoutes.length,
      ...(config.id ? { routingId: config.id } : {}),
      ...(config.description ? { routingDescription: config.description } : {}),
      availableRoutes,
      overridden: _forcedRoute !== undefined,
      hasHints: _hints !== undefined,
    },
  });

  try {
    const result = await span.withContext(async () => {
      let classifiedAs: string;
      let overridden: boolean;

      if (_forcedRoute !== undefined) {
        // .select() was used — skip classify
        classifiedAs = _forcedRoute;
        overridden = true;
      } else {
        // Run classify (may be async)
        classifiedAs = await config.classify(
          input,
          _hints as Parameters<typeof config.classify>[1],
        );
        overridden = false;
      }

      // Resolve model from routes — fall to default if key not found
      const routes = config.routes as Record<string, M>;
      const usedDefaultRoute = !Object.hasOwn(routes, classifiedAs);
      const selectedModel = usedDefaultRoute
        ? routes["default"]
        : routes[classifiedAs];
      const selectedModelId =
        isRouter(selectedModel) || isCascade(selectedModel)
          ? classifiedAs
          : extractModelId(selectedModel as M);

      observe.event({
        name: "router.selected",
        attributes: {
          classifiedAs,
          ...(config.id ? { routingId: config.id } : {}),
          selectedModel: selectedModelId,
          usedDefaultRoute,
          overridden,
          availableRoutes,
        },
      });
      emitRoutingReport(span.spanId, {
        kind: "routing.report",
        routingKind: "router",
        ...(config.id ? { routingId: config.id } : {}),
        chosen: selectedModelId,
        classifiedAs,
        selectedModel: selectedModelId,
        availableRoutes,
      });

      // Recursively resolve (model could be a cascade or another router)
      const result = await resolveModel(
        selectedModel as M,
        input,
        tryModel,
        extractModelId,
        options,
      );

      const routerStep: RouterRoutingStep = {
        kind: "router",
        ...(config.id ? { id: config.id } : {}),
        classifiedAs,
        route: usedDefaultRoute ? "default" : classifiedAs,
        usedDefaultRoute,
        forced: overridden,
      };
      const routing =
        result.routing !== undefined
          ? prependRoutingStep(routerStep, result.routing)
          : createRoutingReceipt(
              selectedModelId,
              routingCostFromMeta(result._meta),
              [routerStep],
            );
      const routedResult = withRoutingReceipt(result, routing);
      span.end({
        attributes: {
          classifiedAs,
          ...(config.id ? { routingId: config.id } : {}),
          selectedModel: selectedModelId,
          usedDefaultRoute,
          overridden,
          routeCount: availableRoutes.length,
        },
      });
      return routedResult;
    });
    return result;
  } catch (error) {
    span.error(error, {
      routeCount: availableRoutes.length,
      ...(config.id ? { routingId: config.id } : {}),
      overridden: _forcedRoute !== undefined,
      hasHints: _hints !== undefined,
    });
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────
// Cascade resolution
// ─────────────────────────────────────────────────────────────────

async function resolveCascade<M, R>(
  cascadeModel: CascadeModel<M>,
  input: Record<string, unknown>,
  tryModel: (model: M, options?: ResolveTryOptions) => Promise<R>,
  extractModelId: (model: M) => string,
  options: {
    deadline: Deadline;
    mode?: "generate" | "stream";
    firstTokenMs?: number;
  },
): Promise<R & { _meta: Record<string, unknown> }> {
  const { tiers, budget } = cascadeModel.config;
  const tierDetails: CascadeTierDetail[] = [];
  let totalCost = 0;
  const cascadeStart = Date.now();
  const latencyDeadline = Deadline.after(budget?.maxLatencyMs);
  let lastResult: R | undefined;
  let lastResultWithMeta: (R & { _meta: Record<string, unknown> }) | undefined;
  const cascadeSpan = observe.openSpan({
    name: "cascade.resolve",
    primitive: "routing.cascade",
    implicitRun: false,
    attributes: {
      totalTiers: tiers.length,
      ...(cascadeModel.config.id ? { routingId: cascadeModel.config.id } : {}),
      ...(cascadeModel.config.description
        ? { routingDescription: cascadeModel.config.description }
        : {}),
      hasCostBudget: budget?.maxCost !== undefined,
      hasLatencyBudget: budget?.maxLatencyMs !== undefined,
      ...(budget?.maxCost !== undefined ? { maxCost: budget.maxCost } : {}),
      ...(budget?.maxLatencyMs !== undefined
        ? { maxLatencyMs: budget.maxLatencyMs }
        : {}),
    },
  });

  try {
    const result = await cascadeSpan.withContext(async () => {
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        const tierStart = Date.now();

        // Check latency budget before running this tier (skip if already exceeded, except first tier)
        if (i > 0 && budget?.maxLatencyMs !== undefined) {
          const elapsed = Date.now() - cascadeStart;
          if (elapsed >= budget.maxLatencyMs) {
            // Budget exceeded — return last result with flag
            markSkippedTiers(
              tierDetails,
              tiers,
              i,
              extractModelId,
              "not reached: latency budget exceeded",
            );
            observe.event({
              name: "cascade.budget_exceeded",
              attributes: {
                budgetKind: "latency",
                elapsedMs: elapsed,
                maxLatencyMs: budget.maxLatencyMs,
                skippedFromTier: i,
              },
            });
            const skipped = buildCascadeResult(
              lastResultWithMeta!,
              tierDetails,
              tiers.length,
              i - 1,
              true,
              cascadeModel.config.id,
            );
            endCascadeSpan(
              cascadeSpan,
              tierDetails,
              tiers.length,
              i - 1,
              true,
              Date.now() - cascadeStart,
              cascadeModel.config.id,
            );
            return skipped;
          }
        }

        // Check cost budget before running this tier (skip if already exceeded, except first tier)
        if (
          i > 0 &&
          budget?.maxCost !== undefined &&
          totalCost >= budget.maxCost
        ) {
          markSkippedTiers(
            tierDetails,
            tiers,
            i,
            extractModelId,
            "not reached: cost budget exceeded",
          );
          observe.event({
            name: "cascade.budget_exceeded",
            attributes: {
              budgetKind: "cost",
              totalCost,
              maxCost: budget.maxCost,
              skippedFromTier: i,
            },
          });
          const skipped = buildCascadeResult(
            lastResultWithMeta!,
            tierDetails,
            tiers.length,
            i - 1,
            true,
            cascadeModel.config.id,
          );
          endCascadeSpan(
            cascadeSpan,
            tierDetails,
            tiers.length,
            i - 1,
            true,
            Date.now() - cascadeStart,
            cascadeModel.config.id,
          );
          return skipped;
        }

        const modelId = describeModel(tier.model, extractModelId);
        const tierSpan = observe.openSpan({
          name: "cascade.tier",
          primitive: "routing.cascade",
          implicitRun: false,
          attributes: {
            tierIndex: i,
            ...(cascadeModel.config.id
              ? { routingId: cascadeModel.config.id }
              : {}),
            model: modelId,
            totalTiers: tiers.length,
            hasEvaluate: Boolean(tier.evaluate),
          },
        });

        try {
          // Run the tier's model (may throw — we don't catch provider errors)
          const result = await tierSpan.withContext(() =>
            resolveModel(tier.model, input, tryModel, extractModelId, {
              deadline: options.deadline,
              mode: options.mode,
              signal: latencyDeadline.signal,
            }),
          );
          const resultWithMeta = ensureMeta(result);
          const durationMs = Date.now() - tierStart;

          // Track only costs that can safely participate in cascade budgets.
          const tierCost = normalizeCascadeTierCost(
            (resultWithMeta._meta as { cost?: unknown }).cost,
            i,
            modelId,
          );
          if (tierCost !== undefined) {
            totalCost += tierCost;
          }

          lastResult = result;
          lastResultWithMeta = resultWithMeta;

          // Evaluate: no evaluate fn on last tier = auto-accept, no evaluate fn on any tier = auto-accept
          if (tier.evaluate) {
            const evaluation = normalizeCascadeTierEvaluation(
              await tierSpan.withContext(() =>
                tier.evaluate!(result, {
                  model: modelId,
                  cost: tierCost,
                  tierIndex: i,
                  totalCost,
                }),
              ),
              tier,
            );
            const accepted = evaluation.accepted;

            observe.event({
              name: "cascade.tier_evaluated",
              attributes: {
                tierIndex: i,
                model: modelId,
                accepted,
                cost: tierCost,
                totalCost,
                ...(evaluation.note ? { note: evaluation.note } : {}),
                ...(evaluation.confidence !== undefined
                  ? { confidence: evaluation.confidence }
                  : {}),
                ...(evaluation.budget !== undefined
                  ? { budget: evaluation.budget }
                  : {}),
              },
            });
            tierDetails.push({
              model: modelId,
              durationMs,
              cost: tierCost,
              status: accepted ? "accepted" : "rejected",
              ...(evaluation.note ? { note: evaluation.note } : {}),
              ...(evaluation.confidence !== undefined
                ? { confidence: evaluation.confidence }
                : {}),
              ...(evaluation.budget !== undefined
                ? { budget: evaluation.budget }
                : {}),
            });
            tierSpan.end({
              attributes: {
                tierIndex: i,
                model: modelId,
                tierStatus: accepted ? "accepted" : "rejected",
                cost: tierCost,
                totalCost,
                durationMs,
                ...(evaluation.note ? { note: evaluation.note } : {}),
                ...(evaluation.confidence !== undefined
                  ? { confidence: evaluation.confidence }
                  : {}),
                ...(evaluation.budget !== undefined
                  ? { budget: evaluation.budget }
                  : {}),
              },
            });

            if (accepted) {
              markSkippedTiers(
                tierDetails,
                tiers,
                i + 1,
                extractModelId,
                "not reached",
              );
              const acceptedResult = buildCascadeResult(
                resultWithMeta,
                tierDetails,
                tiers.length,
                i,
                false,
                cascadeModel.config.id,
              );
              endCascadeSpan(
                cascadeSpan,
                tierDetails,
                tiers.length,
                i,
                false,
                Date.now() - cascadeStart,
                cascadeModel.config.id,
              );
              return acceptedResult;
            }

            // Rejected — check if budget would be exceeded for next tier
            if (budget?.maxCost !== undefined && totalCost >= budget.maxCost) {
              markSkippedTiers(
                tierDetails,
                tiers,
                i + 1,
                extractModelId,
                "not reached: cost budget exceeded",
              );
              observe.event({
                name: "cascade.budget_exceeded",
                attributes: {
                  budgetKind: "cost",
                  totalCost,
                  maxCost: budget.maxCost,
                  skippedFromTier: i + 1,
                },
              });
              const budgetResult = buildCascadeResult(
                resultWithMeta,
                tierDetails,
                tiers.length,
                i,
                true,
                cascadeModel.config.id,
              );
              endCascadeSpan(
                cascadeSpan,
                tierDetails,
                tiers.length,
                i,
                true,
                Date.now() - cascadeStart,
                cascadeModel.config.id,
              );
              return budgetResult;
            }
          } else {
            // No evaluate — accept this tier
            tierDetails.push({
              model: modelId,
              durationMs,
              cost: tierCost,
              status: "accepted",
              note: tier.note ?? "accepted without evaluator",
              ...(tier.budget !== undefined ? { budget: tier.budget } : {}),
            });
            tierSpan.end({
              attributes: {
                tierIndex: i,
                model: modelId,
                tierStatus: "accepted",
                cost: tierCost,
                totalCost,
                durationMs,
                note: tier.note ?? "accepted without evaluator",
                ...(tier.budget !== undefined ? { budget: tier.budget } : {}),
              },
            });

            markSkippedTiers(
              tierDetails,
              tiers,
              i + 1,
              extractModelId,
              "not reached",
            );
            const acceptedResult = buildCascadeResult(
              resultWithMeta,
              tierDetails,
              tiers.length,
              i,
              false,
              cascadeModel.config.id,
            );
            endCascadeSpan(
              cascadeSpan,
              tierDetails,
              tiers.length,
              i,
              false,
              Date.now() - cascadeStart,
              cascadeModel.config.id,
            );
            return acceptedResult;
          }
        } catch (error) {
          if (latencyDeadline.signal.aborted) {
            tierSpan.end({
              attributes: {
                tierIndex: i,
                model: modelId,
                tierStatus: "skipped",
                durationMs: Date.now() - tierStart,
                budgetExceeded: true,
              },
            });
            markSkippedTiers(
              tierDetails,
              tiers,
              i,
              extractModelId,
              "not reached: latency budget exceeded",
            );
            observe.event({
              name: "cascade.budget_exceeded",
              attributes: {
                budgetKind: "latency",
                elapsedMs: Date.now() - cascadeStart,
                maxLatencyMs: budget?.maxLatencyMs,
                skippedFromTier: i,
              },
            });
            if (lastResultWithMeta) {
              const budgetResult = buildCascadeResult(
                lastResultWithMeta,
                tierDetails,
                tiers.length,
                Math.max(0, i - 1),
                true,
                cascadeModel.config.id,
              );
              endCascadeSpan(
                cascadeSpan,
                tierDetails,
                tiers.length,
                Math.max(0, i - 1),
                true,
                Date.now() - cascadeStart,
                cascadeModel.config.id,
              );
              return budgetResult;
            }
            throw new CascadeExhaustedError(lastResult, tierDetails);
          }
          tierSpan.error(error, {
            tierIndex: i,
            model: modelId,
            tierStatus: "error",
            durationMs: Date.now() - tierStart,
          });
          throw error;
        }
      }

      // All tiers tried, all rejected
      const error = new CascadeExhaustedError(lastResult, tierDetails);
      throw error;
    });
    return result;
  } catch (error) {
    cascadeSpan.error(error, {
      totalTiers: tiers.length,
      tiersAttempted: tierDetails.filter((tier) => tier.status !== "skipped")
        .length,
      durationMs: Date.now() - cascadeStart,
    });
    throw error;
  } finally {
    latencyDeadline.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function ensureMeta<R>(result: R): R & { _meta: Record<string, unknown> } {
  if (result && typeof result === "object") {
    const source = result as Record<PropertyKey, unknown>;
    const meta = isRecord(source._meta) ? source._meta : {};
    const clone = Object.assign(Object.create(Object.getPrototypeOf(result)), result) as R & {
      _meta: Record<string, unknown>;
    };
    clone._meta = { ...meta };
    return clone;
  }

  return { value: result, _meta: {} } as unknown as R & {
    _meta: Record<string, unknown>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Return a cost only when it is safe for arithmetic budget accounting.
 * Provider metadata is best-effort, so invalid reported costs are observed
 * and ignored rather than allowed to poison all later budget checks.
 */
function normalizeCascadeTierCost(
  cost: unknown,
  tierIndex: number,
  model: string,
): number | undefined {
  if (cost === undefined) return undefined;
  if (typeof cost === "number" && Number.isFinite(cost)) return cost;

  observe.event({
    name: "cascade.cost_unreliable",
    attributes: {
      tierIndex,
      model,
      costType: typeof cost,
      reportedCost: String(cost),
    },
  });
  return undefined;
}

function buildCascadeResult<R>(
  result: RoutableResult<R>,
  tierDetails: CascadeTierDetail[],
  _totalTiers: number,
  acceptedAtTier: number,
  budgetExceeded: boolean,
  routingId: string | undefined,
): RoutableResult<R> {
  const cascadeStep: CascadeRoutingStep = {
    kind: "cascade",
    ...(routingId ? { id: routingId } : {}),
    acceptedAtTier,
    budgetExceeded,
    tiers: tierDetails,
  };
  const routing =
    result.routing !== undefined
      ? prependRoutingStep(cascadeStep, result.routing)
      : createRoutingReceipt(
          concreteModelFromCascadeStep(cascadeStep),
          routingCostFromMeta(result._meta),
          [cascadeStep],
        );
  return withRoutingReceipt(result, {
    ...routing,
    cost: routingCostFromMeta(result._meta),
  });
}

function endCascadeSpan(
  span: ReturnType<typeof observe.openSpan>,
  tierDetails: readonly CascadeTierDetail[],
  totalTiers: number,
  acceptedAtTier: number,
  budgetExceeded: boolean,
  durationMs: number,
  routingId: string | undefined,
): void {
  const tiersAttempted = tierDetails.filter((tier) => tier.status !== "skipped")
    .length;
  emitRoutingReport(span.spanId, {
    kind: "routing.report",
    routingKind: "cascade",
    ...(routingId ? { routingId } : {}),
    chosen:
      acceptedAtTier >= 0 &&
      tierDetails[acceptedAtTier]
        ? tierDetails[acceptedAtTier].model
        : undefined,
    tiers: tierDetails.map((tier, index) => ({
      tier: index,
      model: tier.model,
      verdict: tier.status,
      note: tier.note,
      confidence: tier.confidence,
      budget: tier.budget,
      cost: tier.cost,
      durationMs: tier.durationMs,
    })),
  });
  span.end({
    attributes: {
      totalTiers,
      ...(routingId ? { routingId } : {}),
      tiersAttempted,
      acceptedAtTier,
      budgetExceeded,
      durationMs,
    },
  });
}

function concreteModelFromCascadeStep(step: CascadeRoutingStep): string {
  const acceptedTier = step.tiers[step.acceptedAtTier];
  return acceptedTier?.model ?? "unknown";
}

function markSkippedTiers<M>(
  tierDetails: CascadeTierDetail[],
  tiers: readonly CascadeTier<M>[],
  fromIndex: number,
  extractModelId: (model: M) => string,
  note = "skipped",
): void {
  for (let j = fromIndex; j < tiers.length; j++) {
    tierDetails.push({
      model: describeModel(tiers[j].model, extractModelId),
      durationMs: 0,
      cost: undefined,
      status: "skipped",
      note,
      ...(tiers[j].budget !== undefined ? { budget: tiers[j].budget } : {}),
    });
  }
}

function describeModel<M>(model: M, extractModelId: (model: M) => string): string {
  if (isRouter(model)) return "router";
  if (isCascade(model)) return "cascade";
  if (isFallback(model)) return "fallback";
  return extractModelId(model);
}

function normalizeCascadeTierEvaluation<M>(
  result: CascadeTierEvaluationResult,
  tier: CascadeTier<M>,
): { accepted: boolean; note?: string; confidence?: number; budget?: number } {
  if (typeof result === "boolean") {
    return {
      accepted: result,
      note:
        tier.note ??
        (result ? "accepted by evaluator" : "rejected by evaluator"),
      ...(tier.budget !== undefined ? { budget: tier.budget } : {}),
    };
  }

  const note =
    result.note ??
    tier.note ??
    defaultEvaluationNote(
      result.accepted,
      result.confidence,
      result.budget ?? tier.budget,
    );
  return {
    accepted: result.accepted,
    ...(note ? { note } : {}),
    ...(typeof result.confidence === "number"
      ? { confidence: result.confidence }
      : {}),
    ...cascadeTierBudget(result.budget, tier.budget),
  };
}

function cascadeTierBudget(
  resultBudget: number | undefined,
  tierBudget: number | undefined,
): { budget?: number } {
  if (typeof resultBudget === "number") {
    return { budget: resultBudget };
  }
  if (tierBudget !== undefined) {
    return { budget: tierBudget };
  }
  return {};
}

function defaultEvaluationNote(
  accepted: boolean,
  confidence?: number,
  budget?: number,
): string {
  if (confidence !== undefined && budget !== undefined) {
    return `confidence ${formatRoutingNumber(confidence)} ${accepted ? ">=" : "<"} ${formatRoutingNumber(budget)}`;
  }
  if (confidence !== undefined) {
    return `confidence ${formatRoutingNumber(confidence)} ${accepted ? "accepted" : "rejected"}`;
  }
  return accepted ? "accepted by evaluator" : "rejected by evaluator";
}

function formatRoutingNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(4)));
}

function emitRoutingReport(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  preview: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: "routing.report",
    contentType: "application/json",
    encoding: "json",
    preview,
    attributes: {
      primitive: "routing.report",
      routingKind:
        typeof preview.routingKind === "string"
          ? preview.routingKind
          : "routing",
    },
  });
  if (!artifactId) return;
  observe.edge({
    edgeType: "produced",
    from: { kind: "span", id: spanId },
    to: { kind: "artifact", id: artifactId },
    attributes: { primitive: "routing.report" },
  });
}
