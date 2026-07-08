import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { router, cascade, retry, split } from "../../routing";
import { resolveModel } from "../../routing/resolve";
import type { ResolveTryOptions } from "../../routing/resolve";
import { fallback } from "../../generation/fallback";
import type { FallbackModel } from "../../generation/fallback";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import { CascadeExhaustedError } from "../../routing/errors";
import type {
  CascadeRoutingStep,
  RouterRoutingStep,
} from "../../routing/receipt";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Fake generate that returns a result with _meta. */
function fakeGenerate(model: string, opts?: { cost?: number }) {
  return {
    text: `response from ${model}`,
    object: { quality: 0.9 },
    _meta: {
      cost: opts?.cost ?? 0.001,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
    },
  };
}

/** Creates a tryModel callback that tracks calls and returns fakeGenerate results. */
function createTryModel(costByModel?: Record<string, number>) {
  const calls: string[] = [];
  const tryModel = async (model: string) => {
    calls.push(model);
    return fakeGenerate(model, { cost: costByModel?.[model] });
  };
  return { tryModel, calls };
}

const extractModelId = (m: string) => m;

function routerStep(result: { routing?: { trace: readonly unknown[] } }) {
  return result.routing?.trace.find(
    (step): step is RouterRoutingStep =>
      typeof step === "object" &&
      step !== null &&
      "kind" in step &&
      step.kind === "router",
  );
}

function cascadeStep(result: { routing?: { trace: readonly unknown[] } }) {
  return result.routing?.trace.find(
    (step): step is CascadeRoutingStep =>
      typeof step === "object" &&
      step !== null &&
      "kind" in step &&
      step.kind === "cascade",
  );
}

// ─────────────────────────────────────────────────────────────────
// Raw model passthrough
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — raw model", () => {
  it("passes raw model through unchanged", async () => {
    const { tryModel, calls } = createTryModel();

    const result = await resolveModel(
      "raw-model",
      {},
      tryModel,
      extractModelId,
    );

    expect(calls).toEqual(["raw-model"]);
    expect(result.text).toBe("response from raw-model");
  });
});

// ─────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — router", () => {
  it("classifies input and selects the matched model", async () => {
    const r = router({
      id: "size-router",
      classify: ({ input }: { input: { big?: boolean }; context: object }) =>
        input.big ? "large" : "small",
      routes: {
        large: "model-large",
        small: "model-small",
        default: "model-small",
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(
      r,
      { big: true },
      tryModel,
      extractModelId,
    );

    expect(calls).toEqual(["model-large"]);
    expect(routerStep(result)).toMatchObject({
      id: "size-router",
      classifiedAs: "large",
      route: "large",
      forced: false,
    });
  });

  it("falls to default when classify returns unknown key", async () => {
    const r = router({
      classify: () => "nonexistent" as "known",
      routes: {
        known: "model-known",
        default: "model-default",
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(r, {}, tryModel, extractModelId);

    expect(calls).toEqual(["model-default"]);
    expect(routerStep(result)).toMatchObject({
      classifiedAs: "nonexistent",
      route: "default",
      usedDefaultRoute: true,
    });
  });

  it("uses forced route from call options, skipping classify", async () => {
    const classify = vi.fn(() => "a" as const);
    const r = router({
      classify,
      routes: { a: "model-a", b: "model-b", default: "model-a" },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(
      r,
      {},
      tryModel,
      extractModelId,
      { forcedRoute: "b" },
    );

    expect(classify).not.toHaveBeenCalled();
    expect(calls).toEqual(["model-b"]);
    expect(routerStep(result)).toMatchObject({
      classifiedAs: "b",
      route: "b",
      forced: true,
    });
  });

  it("passes routing context to classify", async () => {
    const classify = vi.fn(
      ({ context }: { input: unknown; context: { cheap?: boolean } }) => {
        return context.cheap ? "budget" : "premium";
      },
    );
    const r = router({
      classify,
      routes: {
        budget: "model-cheap",
        premium: "model-expensive",
        default: "model-expensive",
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(
      r,
      {},
      tryModel,
      extractModelId,
      { context: { cheap: true } },
    );

    expect(classify).toHaveBeenCalledWith({
      input: {},
      context: { cheap: true },
    });
    expect(calls).toEqual(["model-cheap"]);
    expect(routerStep(result)).toMatchObject({
      classifiedAs: "budget",
      route: "budget",
    });
  });

  it("supports async classify", async () => {
    const r = router({
      classify: async ({ input }: { input: { size: number }; context: object }) => {
        await new Promise((r) => setTimeout(r, 1));
        return input.size > 100 ? "big" : "small";
      },
      routes: {
        big: "model-big",
        small: "model-small",
        default: "model-small",
      },
    });

    const { tryModel, calls } = createTryModel();
    await resolveModel(r, { size: 200 }, tryModel, extractModelId);

    expect(calls).toEqual(["model-big"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Split
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — split", () => {
  it("selects a weighted route from the stable seed", async () => {
    const model = split({
      id: "canary",
      seed: ({ context }: { input: unknown; context: { sessionId: string } }) =>
        context.sessionId,
      routes: {
        stable: { model: "model-stable", weight: 95 },
        canary: { model: "model-canary", weight: 5 },
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(model, {}, tryModel, extractModelId, {
      context: { sessionId: "s_1" },
    });

    expect(calls).toHaveLength(1);
    expect(["model-stable", "model-canary"]).toContain(calls[0]);
    expect(result.routing?.trace[0]).toMatchObject({
      kind: "split",
      id: "canary",
      seed: "s_1",
    });
  });

  it("uses call-site route override for the outer split", async () => {
    const model = split({
      seed: () => "same-seed",
      routes: {
        stable: { model: "model-stable", weight: 100 },
        canary: { model: "model-canary", weight: 0 },
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(model, {}, tryModel, extractModelId, {
      forcedRoute: "canary",
    });

    expect(calls).toEqual(["model-canary"]);
    expect(result.routing?.trace[0]).toMatchObject({
      kind: "split",
      route: "canary",
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Retry
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — retry", () => {
  it("retries qualifying errors and records attempt details", async () => {
    const model = retry("model-a", {
      attempts: 2,
      on: ["rate_limit"],
    });
    const tryModel = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce(fakeGenerate("model-a"));

    const result = await resolveModel(model, {}, tryModel, extractModelId);

    expect(tryModel).toHaveBeenCalledTimes(2);
    expect(result.routing?.trace[0]).toMatchObject({
      kind: "retry",
      model: "model-a",
      attempts: [
        { model: "model-a", status: "error", errorCategory: "rate_limit" },
        { model: "model-a", status: "ok" },
      ],
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// Call profiles
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — call profiles", () => {
  it("passes selected route params to the concrete model attempt", async () => {
    const routed = router({
      classify: () => "fast" as const,
      routes: {
        fast: { model: "model-fast", temperature: 0, maxTokens: 80 },
        default: "model-default",
      },
    });
    const tryModel = vi.fn(
      async (model: string, _options?: ResolveTryOptions) =>
        fakeGenerate(`response from ${model}`),
    );

    await resolveModel(routed, {}, tryModel, extractModelId);

    expect(tryModel).toHaveBeenCalledWith(
      "model-fast",
      expect.objectContaining({
        params: { temperature: 0, maxTokens: 80 },
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Cascade
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — cascade", () => {
  it("accepts first tier when evaluate returns true", async () => {
    const c = cascade({
      tiers: [
        { model: "model-cheap", evaluate: () => true },
        { model: "model-expensive" },
      ],
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(calls).toEqual(["model-cheap"]);
    expect(cascadeStep(result)).toMatchObject({
      acceptedAtTier: 0,
      budgetExceeded: false,
      tiers: [
        expect.objectContaining({ model: "model-cheap", status: "accepted" }),
        expect.objectContaining({
          model: "model-expensive",
          status: "skipped",
          note: "not reached",
        }),
      ],
    });
  });

  it("escalates to next tier when evaluate returns false", async () => {
    const c = cascade({
      tiers: [
        { model: "model-cheap", evaluate: () => false },
        { model: "model-mid", evaluate: () => true },
        { model: "model-expensive" },
      ],
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(calls).toEqual(["model-cheap", "model-mid"]);
    expect(cascadeStep(result)).toMatchObject({
      acceptedAtTier: 1,
    });
    expect(cascadeStep(result)?.tiers[0]?.status).toBe("rejected");
    expect(cascadeStep(result)?.tiers[1]?.status).toBe("accepted");
  });

  it("last tier without evaluate always accepts", async () => {
    const c = cascade({
      tiers: [
        { model: "model-cheap", evaluate: () => false },
        { model: "model-expensive" }, // no evaluate
      ],
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(calls).toEqual(["model-cheap", "model-expensive"]);
    expect(cascadeStep(result)?.acceptedAtTier).toBe(1);
  });

  it("throws CascadeExhaustedError when all tiers fail evaluation", async () => {
    const c = cascade({
      tiers: [
        { model: "model-a", evaluate: () => false },
        { model: "model-b", evaluate: () => false },
      ],
    });

    const { tryModel } = createTryModel();

    await expect(resolveModel(c, {}, tryModel, extractModelId)).rejects.toThrow(
      CascadeExhaustedError,
    );
  });

  it("escalates invalid structured output and then resolves provider outage through nested fallback", async () => {
    const backup = fallback(["model-down", "model-backup"], {
      on: ["server_error"],
    }) as FallbackModel<string>;
    type Model = string | FallbackModel<string>;
    const c = cascade({
      tiers: [
        { model: "model-invalid", escalateOn: ["invalid_response"] },
        { model: backup },
      ],
    });
    const validationError = new ValidationExhaustedError({
      lastRawOutput: "{}",
      zodErrors: z.object({ ok: z.boolean() }).safeParse({ ok: "no" }).error!,
      attempts: 1,
      maxAttempts: 1,
      promptId: "structured",
    });
    const calls: string[] = [];
    const tryModel = vi.fn(async (model: Model) => {
      if (typeof model !== "string") {
        throw new Error("routing wrapper reached concrete model attempt");
      }
      calls.push(model);
      if (model === "model-invalid") throw validationError;
      if (model === "model-down") {
        throw Object.assign(new Error("provider down"), { status: 500 });
      }
      return fakeGenerate(model);
    });
    const extract = (model: Model) => (typeof model === "string" ? model : "fallback");

    const result = await resolveModel(c, {}, tryModel, extract);

    expect(calls).toEqual(["model-invalid", "model-down", "model-backup"]);
    expect(result.text).toBe("response from model-backup");
    expect(result.routing?.trace.map((step) => step.kind)).toEqual([
      "cascade",
      "fallback",
    ]);
    expect(cascadeStep(result)).toMatchObject({
      acceptedAtTier: 1,
      tiers: [
        expect.objectContaining({
          model: "model-invalid",
          status: "rejected",
          note: "invalid_response",
        }),
        expect.objectContaining({ model: "fallback", status: "accepted" }),
      ],
    });
    expect(result.routing?.trace[1]).toMatchObject({
      kind: "fallback",
      attempts: [
        { model: "model-down", status: "error", errorCategory: "server_error" },
        { model: "model-backup", status: "ok" },
      ],
    });
  });

  it("returns last result with budgetExceeded when cost exceeds maxCost", async () => {
    const c = cascade({
      tiers: [
        { model: "model-cheap", evaluate: () => false },
        { model: "model-expensive" },
      ],
      budget: { maxCost: 0.005 },
    });

    // model-cheap costs 0.006 — exceeds budget after tier 1
    // tier 2 is skipped, model-cheap result returned with budgetExceeded
    const { tryModel } = createTryModel({
      "model-cheap": 0.006,
      "model-expensive": 0.01,
    });
    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(cascadeStep(result)?.budgetExceeded).toBe(true);
    expect(result.text).toBe("response from model-cheap");
  });

  it("folds reported judge cost into tier detail, budgets, and receipt cost", async () => {
    const c = cascade({
      tiers: [
        {
          model: "model-cheap",
          evaluate: async ({ report }) => {
            const judged = await report({ score: 0.4, cost: 0.01 });
            return { accepted: judged.score > 0.8, confidence: judged.score };
          },
        },
        { model: "model-expensive" },
      ],
      budget: { maxCost: 0.005 },
    });

    const { tryModel, calls } = createTryModel({
      "model-cheap": 0.001,
      "model-expensive": 0.01,
    });
    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(calls).toEqual(["model-cheap"]);
    expect(result.routing?.cost).toBeCloseTo(0.011);
    expect(cascadeStep(result)).toMatchObject({
      acceptedAtTier: 0,
      budgetExceeded: true,
      tiers: [
        expect.objectContaining({
          model: "model-cheap",
          status: "rejected",
          cost: 0.001,
          judgeCost: 0.01,
        }),
        expect.objectContaining({
          model: "model-expensive",
          status: "skipped",
          note: "not reached: cost budget exceeded",
        }),
      ],
    });
  });

  it("returns last result with budgetExceeded when latency is exceeded before the next tier", async () => {
    const c = cascade({
      tiers: [
        {
          model: "model-cheap",
          evaluate: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return false;
          },
        },
        { model: "model-expensive" },
      ],
      budget: { maxLatencyMs: 1 }, // 1ms — will be exceeded
    });

    const calls: string[] = [];
    const tryModel = async (model: string) => {
      calls.push(model);
      return fakeGenerate(model);
    };

    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(cascadeStep(result)?.budgetExceeded).toBe(true);
    expect(calls).toEqual(["model-cheap"]); // never tried tier 2
  });

  it("aborts an in-flight tier when maxLatencyMs expires and returns the best-so-far result", async () => {
    const c = cascade({
      tiers: [
        { model: "model-cheap", evaluate: () => false },
        { model: "model-slow", evaluate: () => true },
        { model: "model-expensive" },
      ],
      budget: { maxLatencyMs: 25 },
    });

    const calls: string[] = [];
    const tryModel = async (
      model: string,
      options?: { signal?: AbortSignal },
    ) => {
      calls.push(model);
      if (model === "model-slow") {
        if (options?.signal?.aborted) throw options.signal.reason;
        await new Promise<never>((_, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
      }
      return fakeGenerate(model);
    };

    const result = await resolveModel(c, {}, tryModel, extractModelId);

    expect(result.text).toBe("response from model-cheap");
    expect(calls).toEqual(["model-cheap", "model-slow"]);
    expect(cascadeStep(result)).toMatchObject({
      budgetExceeded: true,
      acceptedAtTier: 0,
    });
    expect(cascadeStep(result)?.tiers[1]).toMatchObject({
      model: "model-slow",
      status: "skipped",
      note: "not reached: latency budget exceeded",
    });
  });

  it("throws CascadeExhaustedError when maxLatencyMs expires before any tier returns", async () => {
    const c = cascade({
      tiers: [
        { model: "model-slow", evaluate: () => true },
        { model: "model-expensive" },
      ],
      budget: { maxLatencyMs: 20 },
    });

    const tryModel = async (
      _model: string,
      options?: { signal?: AbortSignal },
    ) => {
      if (options?.signal?.aborted) throw options.signal.reason;
      await new Promise<never>((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true },
        );
      });
      return fakeGenerate("unreachable");
    };

    await expect(
      resolveModel(c, {}, tryModel, extractModelId),
    ).rejects.toBeInstanceOf(CascadeExhaustedError);
  });

  it("propagates provider errors (does not catch them)", async () => {
    const c = cascade({
      tiers: [{ model: "model-a", evaluate: () => true }, { model: "model-b" }],
    });

    const tryModel = async () => {
      throw new Error("Provider is down");
    };

    await expect(resolveModel(c, {}, tryModel, extractModelId)).rejects.toThrow(
      "Provider is down",
    );
  });

  it("passes tier context to evaluate function", async () => {
    const evaluateSpy = vi.fn(() => true);

    const c = cascade({
      tiers: [{ model: "model-a", evaluate: evaluateSpy }],
    });

    const { tryModel } = createTryModel({ "model-a": 0.003 });
    await resolveModel(c, {}, tryModel, extractModelId);

    expect(evaluateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { quality: 0.9 },
        input: {},
        model: "model-a",
        cost: 0.003,
        tierIndex: 0,
        totalCost: 0.003,
        report: expect.any(Function),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────

describe("resolveModel() — composition", () => {
  it("resolves nested router → cascade", async () => {
    const r = router({
      classify: ({ input }: { input: { complex?: boolean }; context: object }) =>
        input.complex ? "hard" : "easy",
      routes: {
        easy: "model-fast",
        hard: cascade({
          tiers: [
            { model: "model-mid", evaluate: () => false },
            { model: "model-powerful" },
          ],
        }),
        default: "model-fast",
      },
    });

    const { tryModel, calls } = createTryModel();
    const result = await resolveModel(
      r,
      { complex: true },
      tryModel,
      extractModelId,
    );

    // Router selected cascade, cascade tried model-mid (rejected) then model-powerful
    expect(calls).toEqual(["model-mid", "model-powerful"]);
    expect(result.routing?.trace.map((step) => step.kind)).toEqual([
      "router",
      "cascade",
    ]);
    expect(routerStep(result)?.classifiedAs).toBe("hard");
    expect(cascadeStep(result)?.acceptedAtTier).toBe(1);
  });
});
