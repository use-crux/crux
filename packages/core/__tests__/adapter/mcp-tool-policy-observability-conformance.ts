import { mcp, stdio } from "@use-crux/mcp";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { prompt } from "../../src/prompt/prompt";
import { toolPolicy } from "../../src/safety/toolPolicy";
import { createMcpPolicyFixture } from "./mcp-policy-fixture";

/** Registers MCP cases for canonical tool-policy decision evidence. */
export function registerMcpToolPolicyObservabilityConformanceTests(): void {
  afterEach(() => {
    resetObservabilityRuntime();
  });

  it("records a reported MCP tool-policy match on the active tool call", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const execute = vi.fn(async () => ({ content: [] }));
    const source = mcp({
      id: "report-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-report",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "report-external-read",
        match: "inspect_record",
        action: "report",
        reason: "External read observed.",
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });
    await observe.flush();

    expect(execute).toHaveBeenCalledOnce();
    const report = transport.records.find(
      (record) =>
        record.type === "artifact" && record.kind === "security.report",
    );
    expect(report).toMatchObject({
      type: "artifact",
      kind: "security.report",
      preview: {
        policyId: "report-external-read",
        boundary: "tool.call",
        mode: "report",
        action: "warn",
        severity: "warn",
        reason: "External read observed.",
        durationMs: expect.any(Number),
        captured: {
          level: "safe",
          sizeBytes: expect.any(Number),
          hash: expect.any(String),
        },
      },
    });
    expect(report?.preview).not.toHaveProperty("captured.preview");
    expect(report?.preview).not.toHaveProperty("captured.raw");

    const toolSpan = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "tool.call" &&
        record.attributes?.toolCallId === "mcp-call-1",
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "produced",
        from: { kind: "span", id: toolSpan?.spanId },
        to: { kind: "artifact", id: report?.artifactId },
      }),
    );
  });

  it("records an allowed MCP tool-policy match exactly once", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const execute = vi.fn(async () => ({ content: [] }));
    const assistant = prompt({
      id: "mcp-allow",
      use: [
        mcp({
          id: "allow-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "allow-inspection",
        match: "inspect_record",
        action: "allow",
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });
    await observe.flush();

    expect(execute).toHaveBeenCalledOnce();
    const reports = transport.records.filter(
      (record) =>
        record.type === "artifact" && record.kind === "security.report",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      preview: {
        policyId: "allow-inspection",
        boundary: "tool.call",
        mode: "enforce",
        action: "allow",
        severity: "info",
      },
    });
  });

  it("records a blocked MCP tool-policy match before transport", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const execute = vi.fn(async () => ({ content: [] }));
    const assistant = prompt({
      id: "mcp-observed-block",
      use: [
        mcp({
          id: "observed-block-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "block-inspection",
        match: "inspect_record",
        action: "block",
        reason: "Inspection blocked.",
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });
    await observe.flush();

    expect(execute).not.toHaveBeenCalled();
    const reports = transport.records.filter(
      (record) =>
        record.type === "artifact" && record.kind === "security.report",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      preview: {
        policyId: "block-inspection",
        boundary: "tool.call",
        mode: "enforce",
        action: "block",
        severity: "error",
        reason: "Inspection blocked.",
      },
    });
  });

  it("records an MCP approval policy match on the approval span", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const execute = vi.fn(async () => ({ content: [] }));
    const assistant = prompt({
      id: "mcp-observed-approval",
      use: [
        mcp({
          id: "observed-approval-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
      toolMiddleware: toolPolicy({
        id: "approve-inspection",
        match: "inspect_record",
        action: "requestApproval",
        reason: "Inspection needs approval.",
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        inspect_record: {
          description: "Inspect a record.",
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
      toolName: "inspect_record",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });
    await observe.flush();

    expect(execute).not.toHaveBeenCalled();
    const report = transport.records.find(
      (record) =>
        record.type === "artifact" && record.kind === "security.report",
    );
    expect(report).toMatchObject({
      preview: {
        policyId: "approve-inspection",
        boundary: "approval.request",
        mode: "enforce",
        action: "request_approval",
        severity: "info",
        reason: "Inspection needs approval.",
      },
    });
    const approvalSpan = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "tool.approval" &&
        record.attributes?.phase === "request",
    );
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "edge",
        edgeType: "produced",
        from: { kind: "span", id: approvalSpan?.spanId },
        to: { kind: "artifact", id: report?.artifactId },
      }),
    );
  });
}
