import { describe, expect, it, vi } from "vitest";
import { fallback } from "../../src/generation/fallback";
import {
  bindCompletedOperation,
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "../../src/adapter/completed-operation";
import { isUnsupportedCapabilityError } from "../../src/content/media-errors";
import { TimeoutError } from "../../src/generation/timeout";

type Result = Readonly<{
  value: string;
  warnings: readonly string[];
  providerMetadata?: Readonly<{ requestId: string }>;
  execution: Readonly<{ kind: "native"; calls: number }>;
  raw: Readonly<{ value: string }>;
}>;

function operation(
  options: Readonly<{
    support?: (model: string) => "supported" | "unsupported" | "unknown";
    invoke?: (
      model: string,
      signal: AbortSignal,
    ) => Promise<Readonly<{ value: string }>>;
    events?: string[];
  }> = {},
) {
  const events = options.events ?? [];
  return defineCompletedOperation({
    normalize: ({ value }: Readonly<{ value: string }>) => {
      events.push("normalize");
      return Object.freeze({ value: value.trim() });
    },
    support: (_input, context) => {
      events.push("support");
      return options.support?.(context.model) ?? "supported";
    },
    async invoke(input, context) {
      events.push("invoke");
      return (
        options.invoke?.(context.model, context.signal) ?? {
          value: `${context.model}:${input.value}`,
        }
      );
    },
    validate(raw): Result {
      events.push("validate");
      return {
        value: raw.value,
        warnings: ["native-warning"],
        providerMetadata: { requestId: "request-1" },
        execution: { kind: "native", calls: 1 },
        raw,
      };
    },
    report(result) {
      events.push("report");
      return { kind: "text", length: result.value.length };
    },
    conformance: [
      { name: "basic", input: { value: "hello" }, model: "model-a" },
    ],
  });
}

describe("completed operation runner", () => {
  it("binds async normalization to the shared lifecycle without storage", async () => {
    const events: string[] = [];
    const definition = defineCompletedOperation({
      async normalize(input: Readonly<{ model: string; value: string }>) {
        events.push("normalize");
        await Promise.resolve();
        return { value: input.value.trim() };
      },
      support: () => {
        events.push("support");
        return "supported" as const;
      },
      invoke: async (input) => {
        events.push("invoke");
        return { value: input.value };
      },
      validate: (raw) => ({
        value: raw.value,
        warnings: [],
        execution: { kind: "native" as const, calls: 1 },
        raw,
      }),
      report: () => ({ kind: "text" }),
      conformance: [],
    });
    const run = bindCompletedOperation({
      definition,
      provider: "test",
      operation: "media.test",
    });

    await expect(
      run({ model: "model-a", value: " hello " }),
    ).resolves.toMatchObject({
      value: "hello",
      execution: { kind: "native", calls: 1 },
    });
    expect(events).toEqual(["normalize", "support", "invoke"]);
  });

  it("runs the immutable lifecycle in order and finalizes common result facts", async () => {
    const events: string[] = [];
    const reports: unknown[] = [];
    const definition = operation({ events });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "media.test",
      model: "model-a",
      input: { value: " hello " },
      onReport: (report) => reports.push(report),
    });

    expect(events).toEqual([
      "normalize",
      "support",
      "invoke",
      "validate",
      "report",
    ]);
    expect(result).toEqual({
      value: "model-a:hello",
      warnings: ["native-warning"],
      providerMetadata: { requestId: "request-1" },
      execution: { kind: "native", calls: 1 },
      raw: { value: "model-a:hello" },
    });
    expect(reports).toEqual([{ kind: "text", length: 13 }]);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.conformance)).toBe(true);
  });

  it("rejects known unsupported candidates before invoking any candidate while unknown reaches native validation", async () => {
    const invoke = vi.fn(async (model: string) => ({ value: model }));
    const definition = operation({
      support: (model) =>
        model === "blocked"
          ? "unsupported"
          : model === "future"
            ? "unknown"
            : "supported",
      invoke,
    });

    await expect(
      runCompletedMediaOperation({
        definition,
        provider: "test",
        operation: "media.test",
        model: fallback(["ok", "blocked"]),
        input: { value: "hello" },
      }),
    ).rejects.toSatisfy(isUnsupportedCapabilityError);
    expect(invoke).not.toHaveBeenCalled();

    await expect(
      runCompletedMediaOperation({
        definition,
        provider: "test",
        operation: "media.test",
        model: "future",
        input: { value: "hello" },
      }),
    ).resolves.toMatchObject({ value: "future" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves direct native errors, applies step and total deadlines, and forwards cancellation", async () => {
    const native = new Error("provider exploded");
    await expect(
      runCompletedMediaOperation({
        definition: operation({
          invoke: async () => {
            throw native;
          },
        }),
        provider: "test",
        operation: "media.test",
        model: "model-a",
        input: { value: "hello" },
      }),
    ).rejects.toBe(native);

    await expect(
      runCompletedMediaOperation({
        definition: operation({ invoke: async () => new Promise(() => {}) }),
        provider: "test",
        operation: "media.test",
        model: "model-a",
        input: { value: "hello" },
        timeout: { stepMs: 5, totalMs: 50 },
      }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      budget: "step",
    } satisfies Partial<TimeoutError>);

    await expect(
      runCompletedMediaOperation({
        definition: operation({ invoke: async () => new Promise(() => {}) }),
        provider: "test",
        operation: "media.test",
        model: "model-a",
        input: { value: "hello" },
        timeout: { totalMs: 5 },
      }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      budget: "total",
    } satisfies Partial<TimeoutError>);

    const controller = new AbortController();
    const cancelled = new Error("caller cancelled");
    controller.abort(cancelled);
    await expect(
      runCompletedMediaOperation({
        definition: operation(),
        provider: "test",
        operation: "media.test",
        model: "model-a",
        input: { value: "hello" },
        abortSignal: controller.signal,
      }),
    ).rejects.toBe(cancelled);
  });

  it("sanitizes operation reports before they reach the descriptor sink", async () => {
    const reports: unknown[] = [];
    const unsafeReport = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: async () => ({ value: "ok" }),
      validate: (raw) => ({
        value: raw.value,
        warnings: [],
        execution: { kind: "native" as const, calls: 1 },
        raw,
      }),
      report: () => ({
        url: "https://example.test/media?token=secret",
        payload: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=",
      }),
      conformance: [],
    });

    await runCompletedMediaOperation({
      definition: unsafeReport,
      provider: "test",
      operation: "media.test",
      model: "model-a",
      input: { value: "hello" },
      onReport: (report) => reports.push(report),
    });

    expect(reports).toEqual([{ url: "[url]", payload: "[redacted media]" }]);
  });
});
