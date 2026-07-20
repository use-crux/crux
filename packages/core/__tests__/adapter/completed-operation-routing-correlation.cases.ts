import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "@use-crux/core";
import {
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "@use-crux/core/adapter";
import { retry, router } from "@use-crux/core/routing";

describe("completed media routing correlation", () => {
  afterEach(() => resetObservabilityRuntime());

  it("retains one outer media pair across routing and retry attempts", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let attempts = 0;
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ value: string }>) => input,
      support: () => "supported" as const,
      invoke: (_input, context) =>
        context.call("image.generate", async () => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("retry"), { status: 503 });
          }
          return { value: context.model };
        }),
      validate: (raw) => ({
        value: raw.value,
        warnings: [] as const,
        execution: { kind: "native" as const, calls: 1 },
        raw,
      }),
      report: () => ({ kind: "image" as const, count: 1 }),
      conformance: [],
    });
    const selected = router({
      classify: () => "image" as const,
      routes: { image: retry("image-model", { attempts: 2 }) },
    });

    const result = await runCompletedMediaOperation({
      definition,
      provider: "test",
      operation: "generateImage",
      model: selected,
      input: { value: "image" },
    });
    await observe.flush();

    const mediaSpans = transport.records.filter(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "media.generate_image",
    );
    expect(mediaSpans).toHaveLength(1);
    expect(result._meta).toEqual({
      traceId: mediaSpans[0]?.traceId,
      spanId: mediaSpans[0]?.spanId,
    });
    expect(result.execution.calls).toBe(2);
  });
});
