import { describe, expect, it } from "vitest";
import {
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "../../src/adapter/completed-operation";
import { fallback } from "../../src/generation/fallback";
import { retry } from "../../src/routing/retry";
import { router } from "../../src/routing/router";
import { split } from "../../src/routing/split";

function routedOperation(
  invoke: (model: string) => Promise<Readonly<{ value: string }>>,
) {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ value: string }>) => input,
    support: () => "supported" as const,
    invoke: async (
      _input,
      context: Readonly<{ model: string; signal: AbortSignal }>,
    ) => invoke(context.model),
    validate: (raw) => ({
      value: raw.value,
      warnings: [],
      execution: { kind: "native" as const, calls: 1 },
      raw,
    }),
    report: () => ({}),
    conformance: [],
  });
}

describe("completed operation routing", () => {
  it("routes retry, fallback, router, and split without losing attempts or causes", async () => {
    const attempts = new Map<string, number>();
    const errors = [
      Object.assign(new Error("primary unavailable"), { status: 503 }),
      new Error("backup failed"),
    ];
    const definition = routedOperation(async (model) => {
      attempts.set(model, (attempts.get(model) ?? 0) + 1);
      if (model === "flaky" && attempts.get(model) === 1) throw errors[0];
      if (model === "primary") throw errors[0];
      if (model === "backup") throw errors[1];
      return { value: model };
    });

    const retried = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: retry("flaky", { attempts: 2 }),
      input: { value: "hello" },
    });
    expect(retried.execution.calls).toBe(2);

    const selected = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: router({
        classify: () => "chosen" as const,
        routes: { chosen: "router-model", default: "default-model" },
      }),
      input: { value: "hello" },
    });
    expect(selected.value).toBe("router-model");

    const bucketed = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: split({
        seed: () => "stable",
        routes: { only: { model: "split-model", weight: 1 } },
      }),
      input: { value: "hello" },
    });
    expect(bucketed.value).toBe("split-model");

    const recovered = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: fallback(["primary", "success"]),
      input: { value: "hello" },
    });
    expect(recovered.execution.calls).toBe(2);

    let aggregate: unknown;
    try {
      await runCompletedMediaOperation({
        definition,
        provider: "test",
        operation: "media.test",
        model: fallback(["primary", "backup"]),
        input: { value: "hello" },
      });
    } catch (error) {
      aggregate = error;
    }
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual(errors);
  });

  it("adds failed attempts to composed call facts and reports the selected route", async () => {
    const reports: unknown[] = [];
    let failed = false;
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: async (
        _input,
        context: Readonly<{ model: string; signal: AbortSignal }>,
      ) => {
        if (!failed) {
          failed = true;
          throw Object.assign(new Error("retry me"), { status: 503 });
        }
        return { model: context.model };
      },
      validate: (raw) => ({
        value: raw.model,
        warnings: [],
        execution: {
          kind: "composed" as const,
          calls: 2,
          operations: ["upload", "generate"],
        },
        raw,
      }),
      report: (result, _input, context) => ({
        model: context.model,
        value: result.value,
      }),
      conformance: [],
    });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: retry("first", { attempts: 2 }),
      input: { value: "hello" },
      onReport: (report) => reports.push(report),
    });

    expect(result.execution).toEqual({
      kind: "composed",
      calls: 3,
      operations: ["upload", "generate"],
    });
    expect(reports).toEqual([{ model: "first", value: "first" }]);
  });
});
