import { afterEach, describe, expect, it } from "vitest";
import {
  context,
  droppable,
  prefer,
  prompt,
} from "../src";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../src/observability";
import { representationAdapter } from "./request-representation-harness";

afterEach(() => {
  resetObservabilityRuntime();
});

describe("request planning observability", () => {
  it("emits redacted executed receipt evidence on the canonical event spine", async () => {
    const privateFull = "PRIVATE_STYLE_GUIDE ".repeat(300);
    const privateOptional = "PRIVATE_REPLY_EXAMPLE ".repeat(300);
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const harness = representationAdapter();
    const full = context({ id: "style-full", system: privateFull });
    const compact = context({
      id: "style-compact",
      system: "Keep answers short and warm.",
    });
    const examples = context({
      id: "reply-examples",
      system: privateOptional,
    });
    const reply = prompt({
      id: "planning-observability",
      use: [prefer(full, compact), droppable(examples)],
      system: "You are a support assistant.",
      prompt: "Answer.",
    });

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      inputBudget: { optimizeAt: 80, max: 120 },
    });
    await observe.flush();

    const receipt = result.steps[0]!.request!;
    const artifact = transport.records.find(
      (record) => record.type === "artifact" && record.kind === "request.plan",
    );
    expect(artifact).toMatchObject({
      type: "artifact",
      kind: "request.plan",
      preview: {
        kind: "request.plan",
        receipt: {
          id: receipt.id,
          model: "model-1",
          inputTokens: expect.any(Number),
          maxInputTokens: 120,
          measurement: "estimated",
          adaptations: [
            expect.objectContaining({
              contributor: "style-full",
              representation: "authored",
            }),
            expect.objectContaining({
              contributor: "reply-examples",
              representation: "omitted",
            }),
          ],
        },
        inspection: {
          id: receipt.id,
          contributions: expect.arrayContaining([
            expect.objectContaining({
              id: "prompt",
              boundary: "required",
              representations: ["full"],
            }),
            expect.objectContaining({
              id: "style-full",
              boundary: "sticky",
              representations: ["full", "authored"],
            }),
            expect.objectContaining({
              id: "reply-examples",
              boundary: "elastic",
              representations: ["full", "omitted"],
            }),
          ]),
          candidates: expect.any(Array),
          linkedRequestIds: [],
        },
      },
    });
    expect(JSON.stringify(artifact)).not.toContain(privateFull.trim());
    expect(JSON.stringify(artifact)).not.toContain(privateOptional.trim());
  });

  it("finalizes retained inspection after preparation evidence is committed", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const harness = representationAdapter({ transportRetries: 2 });
    const reply = prompt({
      id: "planning-observability-prepared",
      prompt: "Answer.",
    });

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      prepareStep: () => undefined,
    });
    await observe.flush();

    const receipt = result.steps[0]!.request!;
    const artifacts = transport.records.filter(
      (record) =>
        record.type === "artifact" &&
        record.kind === "request.plan" &&
        record.attributes.requestId === receipt.id,
    );
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      preview: {
        stage: "sealed",
      },
    });
    expect(JSON.stringify(artifacts[0])).not.toContain('"preparation"');
    expect(artifacts[1]).toMatchObject({
      preview: {
        stage: "completed",
        inspection: {
          preparation: {
            operation: "language",
            stepIndex: 0,
            reason: "initial",
            sealedRequestId: receipt.id,
          },
          retryCount: 2,
        },
      },
    });
  });
});
