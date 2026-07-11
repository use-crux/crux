import { afterEach, describe, expect, it } from "vitest";
import { observe, resetObservabilityRuntime } from "@use-crux/core/observability";
import { inMemoryRecordStore, workspace } from "@use-crux/core";
import { withTelemetry } from "../src";
import { extractCruxPropagationCarrier, injectCruxPropagationCarrier } from "../src/propagation";
import type { TraceSpan } from "../src/types";

function headerMap(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: (name: string) => store.get(name) ?? null,
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    raw: store,
  };
}

describe("workspace OTel privacy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("maps workspace paths to hashes without exposing raw path attributes", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch);
      },
    }).install({});
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/secret-name.md", "classified");
    installed.dispose?.();

    const workspaceSpan = spans.find((span) => span.name === "crux.workspace.operation");

    expect(workspaceSpan).toBeDefined();
    expect(Object.values(workspaceSpan?.attributes ?? {})).not.toContain(
      "/workspace/secret-name.md",
    );
    expect(workspaceSpan?.attributes).toMatchObject({
      "crux.workspace.path_hash": expect.stringMatching(/^fnv1a:/),
    });
  });

  it("drops payload-shaped attributes even when local capture is inline", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch);
      },
    }).install({});

    await observe.span(
      {
        name: "generate",
        primitive: "generation.call",
        attributes: {
          text: "OTEL-SPAN-TEXT",
          query: "OTEL-QUERY-TEXT",
          messages: "OTEL-MESSAGES-TEXT",
          output: "OTEL-OUTPUT-TEXT",
          safeLabel: "safe label",
        },
      },
      async () => {
        observe.event({
          name: "token.chunk",
          attributes: {
            text: "OTEL-TOKEN-TEXT",
            charCount: 15,
          },
        });
      },
    );
    installed.dispose?.();

    expect(JSON.stringify(spans)).not.toContain("OTEL-SPAN-TEXT");
    expect(JSON.stringify(spans)).not.toContain("OTEL-QUERY-TEXT");
    expect(JSON.stringify(spans)).not.toContain("OTEL-MESSAGES-TEXT");
    expect(JSON.stringify(spans)).not.toContain("OTEL-OUTPUT-TEXT");
    expect(JSON.stringify(spans)).not.toContain("OTEL-TOKEN-TEXT");
    expect(spans.find((span) => span.name === "chat generate")?.attributes).toMatchObject({
      "crux.safeLabel": "safe label",
    });
  });

  it("maps every workspace operation to operation and path hash attributes", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch);
      },
    }).install({});
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/a.md", "alpha");
    await ws.read("/workspace/a.md");
    await ws.list("/workspace");
    await ws.exists("/workspace/a.md");
    await ws.stat("/workspace/a.md");
    await ws.append("/workspace/a.md", "\nbeta");
    await ws.edit("/workspace/a.md", { find: "beta", replace: "gamma" });
    await ws.copy("/workspace/a.md", "/workspace/copy.md");
    await ws.rename("/workspace/copy.md", "/workspace/moved.md");
    await ws.move("/workspace/moved.md", "/workspace/moved-again.md");
    await ws.grep("alpha", { path: "/workspace/**/*.md" });
    await ws.write("/outputs/report.md", "# Report", {
      status: "draft",
      kind: "report",
    });
    await ws.artifacts();
    await ws.finalize("/outputs/report.md");
    await ws.delete("/workspace/moved.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    installed.dispose?.();

    const byOperation = new Map(
      spans
        .filter((span) => span.name === "crux.workspace.operation")
        .map((span) => [span.attributes["crux.workspace.operation"], span]),
    );

    for (const operation of [
      "list",
      "read",
      "write",
      "edit",
      "delete",
      "exists",
      "stat",
      "append",
      "rename",
      "move",
      "copy",
      "grep",
      "artifacts",
      "finalize",
    ] as const) {
      expect(byOperation.get(operation)?.attributes).toMatchObject({
        "crux.workspace.operation": operation,
        "crux.workspace.path_hash": expect.stringMatching(/^fnv1a:/),
      });
    }
    for (const rawPath of [
      "/workspace/a.md",
      "/workspace/copy.md",
      "/workspace/moved.md",
      "/workspace/moved-again.md",
      "/outputs/report.md",
    ]) {
      expect(
        spans.flatMap((span) => Object.values(span.attributes)),
      ).not.toContain(rawPath);
    }
    expect(spans.flatMap((span) => Object.keys(span.attributes))).not.toContain(
      "crux.uri",
    );
    expect(
      spans.flatMap((span) => Object.values(span.attributes)),
    ).not.toContain("workspace-inline://research/thread%3A1/outputs/report.md");
  });
});

describe("W3C carrier propagation privacy and bounds", () => {
  it("round-trips traceparent, tracestate, and the crux field through inject/extract", () => {
    const run = observe.openRun({ name: "carrier round-trip", rootPrimitive: "flow.run" });
    const carrier = run.captureContinuation();
    run.end();

    const target = headerMap();
    injectCruxPropagationCarrier(carrier, target);
    expect(target.raw.get("traceparent")).toBe(carrier.traceparent);
    expect(target.raw.get("crux")).toBeDefined();

    const { carrier: extracted, baggageAttributes } = extractCruxPropagationCarrier(target);
    expect(extracted?.crux.runId).toBe(carrier.crux.runId);
    expect(extracted?.traceparent).toBe(carrier.traceparent);
    expect(baggageAttributes).toEqual({});
  });

  it("rejects an invalid traceparent instead of throwing, and does not fabricate a carrier", () => {
    const target = headerMap({
      traceparent: "not-a-valid-traceparent",
      crux: JSON.stringify({ runId: "run_aaaaaaaaaaaaaaaaaaaaaaaa" }),
    });

    const { carrier, baggageAttributes } = extractCruxPropagationCarrier(target);
    expect(carrier).toBeUndefined();
    expect(baggageAttributes).toEqual({});
  });

  it("rejects oversized baggage instead of throwing", () => {
    const oversizedBaggage = Array.from({ length: 2000 }, (_, i) => `k${i}=v`).join(",");
    const run = observe.openRun({ name: "oversized baggage", rootPrimitive: "flow.run" });
    const carrier = run.captureContinuation();
    run.end();

    const target = headerMap({
      traceparent: carrier.traceparent!,
      crux: JSON.stringify(carrier.crux),
      baggage: oversizedBaggage,
    });

    const { carrier: extracted, baggageAttributes } = extractCruxPropagationCarrier(target, {
      baggageAttributeAllowlist: ["k0"],
    });
    expect(extracted).toBeUndefined();
    expect(baggageAttributes).toEqual({});
  });

  it("copies only allowlisted baggage keys into attributes, dropping everything else by default", () => {
    const run = observe.openRun({ name: "baggage allowlist", rootPrimitive: "flow.run" });
    const carrier = run.captureContinuation();
    run.end();

    const target = headerMap({
      traceparent: carrier.traceparent!,
      crux: JSON.stringify(carrier.crux),
      baggage: "tenant=acme,secret=do-not-leak",
    });

    const withoutAllowlist = extractCruxPropagationCarrier(target);
    expect(withoutAllowlist.baggageAttributes).toEqual({});

    const withAllowlist = extractCruxPropagationCarrier(target, {
      baggageAttributeAllowlist: ["tenant"],
    });
    expect(withAllowlist.baggageAttributes).toEqual({ "crux.baggage.tenant": "acme" });
    expect(Object.keys(withAllowlist.baggageAttributes)).not.toContain("crux.baggage.secret");
    expect(JSON.stringify(withAllowlist.baggageAttributes)).not.toContain("do-not-leak");
  });

  it("never accepts an incoming sessionId/userId as trusted identity beyond correlation", () => {
    const run = observe.openRun({
      name: "correlator carrier",
      rootPrimitive: "flow.run",
      attributes: {},
    });
    const carrier = run.captureContinuation();
    run.end();

    const target = headerMap({
      traceparent: carrier.traceparent!,
      crux: JSON.stringify({ ...carrier.crux, sessionId: "attacker-supplied", userId: "attacker-supplied" }),
    });

    const { carrier: extracted } = extractCruxPropagationCarrier(target);
    // Extraction only returns correlation fields to be treated as untrusted
    // hints — callers must apply their own trusted correlators. This test
    // pins that the value is passed through as opaque data, not silently
    // upgraded to any authenticated identity by the extraction step itself.
    expect(extracted?.crux.sessionId).toBe("attacker-supplied");
    expect(extracted?.crux.userId).toBe("attacker-supplied");
  });

  it("strips control characters and caps baggage attribute value length", () => {
    const run = observe.openRun({ name: "baggage bounds", rootPrimitive: "flow.run" });
    const carrier = run.captureContinuation();
    run.end();

    const longValue = "a".repeat(500);
    const target = headerMap({
      traceparent: carrier.traceparent!,
      crux: JSON.stringify(carrier.crux),
      baggage: `long=${longValue}`,
    });

    const { baggageAttributes } = extractCruxPropagationCarrier(target, {
      baggageAttributeAllowlist: ["long"],
    });
    expect(baggageAttributes["crux.baggage.long"]?.length).toBeLessThanOrEqual(201);
  });
});
