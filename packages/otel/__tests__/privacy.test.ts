import { afterEach, describe, expect, it } from "vitest";
import { observe, resetObservabilityRuntime } from "@use-crux/core/observability";
import { inMemoryRecordStore, workspace } from "@use-crux/core";
import { withTelemetry } from "../src";
import type { TraceSpan } from "../src/types";

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
