import { afterEach, describe, expect, it } from "vitest";
import { evidence } from "@use-crux/core";
import {
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from "@use-crux/core/observability";

import { createCallbackExporter } from "../src/exporter";
import { createOtelRecordSubscriber } from "../src/record-mapper";
import { createLightweightSpanManager } from "../src/span-manager";
import { withTelemetry } from "../src";
import type { TraceSpan } from "../src/types";

describe("evidence OTel attachment", () => {
  afterEach(() => resetObservabilityRuntime());

  it("attaches to the protected producer, never the described subject", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter(batch) {
        spans.push(...batch);
      },
    }).install({});

    const identities = await authorEvidenceAboutAnotherSpan();
    installed.dispose?.();

    const producer = spans.find(
      (span) => span.spanId === identities.producerSpanId,
    );
    const subject = spans.find(
      (span) => span.spanId === identities.subjectSpanId,
    );
    expect(
      producer?.events?.some((event) => event.name === "crux.evidence"),
    ).toBe(true);
    expect(
      subject?.events?.some((event) => event.name === "crux.evidence") ??
        false,
    ).toBe(false);
  });

  it("drops an unresolved producer without falling back to edge endpoints", async () => {
    const records: CruxGraphRecord[] = [];
    const unsubscribe = subscribeObservability((record) =>
      records.push(record),
    );
    await authorEvidenceAboutAnotherSpan();
    unsubscribe();
    resetObservabilityRuntime();

    const spans: TraceSpan[] = [];
    const manager = createLightweightSpanManager(
      createCallbackExporter((batch) => {
        spans.push(...batch);
      }),
    );
    const subscriber = createOtelRecordSubscriber(manager);
    for (const record of records) {
      subscriber(
        record.type === "edge" && record.edgeType === "evidence.for"
          ? ({
              ...record,
              attributes: {
                ...record.attributes,
                producer: { kind: "span", id: "7777777777777777" },
              },
            } as CruxGraphRecord)
          : record,
      );
    }
    await manager.forceFlush();

    expect(
      spans
        .flatMap((span) => span.events ?? [])
        .some((event) => event.name === "crux.evidence"),
    ).toBe(false);
  });

  it("attaches run-produced evidence to the owning run span", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter(batch) {
        spans.push(...batch);
      },
    }).install({});

    const run = observe.openRun({
      name: "run producer",
      rootPrimitive: "run",
    });
    await run.withContext(async () => {
        evidence.record({
          subject: { kind: "execution", id: run.runId },
          role: "intent",
          kind: "custom.run-intent",
          data: { configured: true },
        });
    });
    run.end();
    installed.dispose?.();

    expect(
      spans
        .find((span) => span.name === "run producer")
        ?.events?.find((event) => event.name === "crux.evidence"),
    ).toMatchObject({
      attributes: expect.objectContaining({
        "crux.evidence.role": "intent",
        "crux.evidence.subject_kind": "run",
      }),
    });
  });
});

async function authorEvidenceAboutAnotherSpan(): Promise<{
  readonly producerSpanId: string;
  readonly subjectSpanId: string;
}> {
  return await observe.run(
    { name: "evidence attachment", rootPrimitive: "run" },
    async () => {
      const subject = observe.openSpan({
        name: "subject",
        primitive: "constraint.check",
      });
      const producer = observe.openSpan({
        name: "producer",
        primitive: "scoring.judge",
      });
      producer.withContext(() => {
        evidence.record({
          subject: { kind: "execution", id: subject.spanId },
          role: "verification",
          kind: "custom.review",
          conclusion: "passed",
          data: { safe: true },
        });
      });
      producer.end();
      subject.end();
      return {
        producerSpanId: producer.spanId,
        subjectSpanId: subject.spanId,
      };
    },
  );
}
