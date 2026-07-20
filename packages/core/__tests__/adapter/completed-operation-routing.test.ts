import { describe, expect, it } from "vitest";
import "./completed-operation-routing-correlation.cases";
import {
  bindCompletedOperation,
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "../../src/adapter/completed-operation";
import { fallback } from "../../src/generation/fallback";
import { retry } from "../../src/routing/retry";
import { router } from "../../src/routing/router";
import { split } from "../../src/routing/split";
import type { RouteArgs } from "../../src/routing/types";

function routedOperation(
  invoke: (model: string) => Promise<Readonly<{ value: string }>>,
) {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ value: string }>) => input,
    support: () => "supported" as const,
    invoke: async (
      _input,
      context: Readonly<{
        model: string;
        signal: AbortSignal;
        call: <T>(operation: string, start: () => Promise<T>) => Promise<T>;
      }>,
    ) => context.call("media.test", () => invoke(context.model)),
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
  it("reaches routed leaves through the bound public operation", async () => {
    const normalizedModels: unknown[] = [];
    const invokedModels: unknown[] = [];
    const definition = defineCompletedOperation({
      normalize: (
        input: Readonly<{ model: string; value: string }>,
        context,
      ) => {
        normalizedModels.push(input.model, context.model);
        return { value: input.value };
      },
      support: () => "supported" as const,
      invoke: async (_input, context) => context.call("media.test", async () => {
        invokedModels.push(context.model);
        return { value: context.model };
      }),
      validate: (raw) => ({
        value: raw.value,
        warnings: [],
        execution: { kind: "native" as const, calls: 1 },
        raw,
      }),
      report: () => ({}),
      conformance: [],
    });
    const run = bindCompletedOperation({
      definition,
      provider: "test",
      operation: "media.test",
    });
    const model = router({
      classify: ({ context }: RouteArgs<{ readonly tier: "pro" }>) =>
        context.tier,
      routes: { pro: "selected", default: "default" },
    });

    const result = await run({
      model,
      value: "hello",
      routing: { tier: "pro" },
    });
    const overridden = await run({
      model,
      value: "hello",
      routing: { tier: "pro" },
      route: "default",
    });

    expect(result.value).toBe("selected");
    expect(overridden.value).toBe("default");
    expect(normalizedModels).toEqual([
      "selected",
      "selected",
      "default",
      "default",
      "selected",
      "selected",
      "default",
      "default",
    ]);
    expect(invokedModels).toEqual(["selected", "default"]);
  });

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
      invoke: async (_input, context) => {
        await context.call("upload", async () => ({ id: "file-1" }));
        return context.call("generate", async () => {
          if (!failed) {
            failed = true;
            throw Object.assign(new Error("retry me"), { status: 503 });
          }
          return { model: context.model };
        });
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
        kind: "file" as const,
        count: result.value === context.model ? 1 : 0,
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
      calls: 4,
      operations: ["upload", "generate"],
    });
    expect(reports).toEqual([{ kind: "file", count: 1 }]);
  });

  it("adds failed attempts to the provider-reported native call count", async () => {
    let attempted = false;
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: async (_input, context) => context.call("media.test", async () => {
        if (!attempted) {
          attempted = true;
          throw Object.assign(new Error("retry me"), { status: 503 });
        }
        return { value: "ok" };
      }),
      validate: (raw) => ({
        value: raw.value,
        warnings: [],
        execution: { kind: "native" as const, calls: 2 },
        raw,
      }),
      report: () => ({}),
      conformance: [],
    });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: retry("model", { attempts: 2 }),
      input: { value: "hello" },
    });

    expect(result.execution).toEqual({ kind: "native", calls: 2 });
  });

  it("applies fallback attempt budgets and keeps fallback hooks non-invasive", async () => {
    const transitions: string[] = [];
    const definition = routedOperation(async (model) => {
      if (model === "slow") return new Promise(() => {});
      return { value: model };
    });
    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: fallback(["slow", "ok"], {
        timeout: { attempt: 5 },
        onFallback: ({ from, to }) => {
          transitions.push(`${from}->${to}`);
          throw new Error("observer failed");
        },
      }),
      input: { value: "hello" },
    });
    expect(result.value).toBe("ok");
    expect(result.execution.calls).toBe(2);
    expect(transitions).toEqual(["slow->ok"]);

    await expect(
      runCompletedMediaOperation({
        definition,
        provider: "test",
        operation: "media.test",
        model: fallback(["ok", "unused"], {
          when: () => {
            throw new Error("predicate observer failed");
          },
        }),
        input: { value: "hello" },
      }),
    ).resolves.toMatchObject({ value: "ok" });
  });
});
