import { afterEach, describe, expect, it } from "vitest";

import { createToolLifecycle } from "../../src/adapter/tool/session";
import { emitToolApprovalRequestAuthority } from "../../src/adapter/tool/approval-evidence";
import {
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";

describe("SDK-owned tool approval attempts", () => {
  afterEach(() => resetObservabilityRuntime());

  it("closes an unconsumed attempted call as skipped with a bounded reason", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const lifecycle = createToolLifecycle({
      regime: "sdk",
      resolved: {
        tools: {
          remove: {
            description: "remove",
            execute: async () => "removed",
          },
        },
      },
      call: { toolApproval: { remove: "always" } },
      promptId: "approval-attempt",
    });

    await expect(
      lifecycle.requiresApproval(
        { id: "call_remove", name: "remove", args: { id: "1" } },
        [],
      ),
    ).resolves.toBe(true);
    await lifecycle.captureTurn({ messages: [] });
    await observe.flush();

    const attempt = transport.records.find(
      (record) =>
        record.type === "span:start" &&
        record.primitive === "tool.call" &&
        record.attributes?.toolCallId === "call_remove",
    );
    expect(attempt).toBeDefined();
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:end",
        spanId: attempt?.spanId,
        status: "skipped",
        attributes: expect.objectContaining({
          reason: "sdk_attempt_unconsumed",
        }),
      }),
    );
  });

  it("reuses one attempt across duplicate approval evaluation", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const lifecycle = createToolLifecycle({
      regime: "sdk",
      resolved: {
        tools: {
          remove: {
            description: "remove",
            execute: async () => "removed",
          },
        },
      },
      call: { toolApproval: { remove: "always" } },
      promptId: "approval-attempt",
    });
    const call = {
      id: "call_remove",
      name: "remove",
      args: { id: "1" },
    };

    await lifecycle.requiresApproval(call, []);
    await lifecycle.requiresApproval(call, []);
    lifecycle.suspend(
      [
        {
          toolCallId: call.id,
          toolName: call.name,
          input: call.args,
        },
      ],
      { text: "", toolCalls: [call] },
      [],
    );
    await observe.flush();

    expect(
      transport.records.filter(
        (record) =>
          record.type === "span:start" &&
          record.primitive === "tool.call" &&
          record.attributes?.toolCallId === call.id,
      ),
    ).toHaveLength(1);
  });

  it("diagnoses an invalid deterministic approval artifact without leaking it", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const run = observe.openRun({
      name: "invalid approval identity",
      rootPrimitive: "custom.operation",
    });
    let attempt: ReturnType<typeof observe.openSpan> | undefined;
    run.withContext(() => {
      attempt = observe.openSpan({
        name: "attempt",
        primitive: "tool.call",
      });
    });
    const invalidApprovalId = "not-an-approval-id-secret";
    let lifecycle: ReturnType<typeof emitToolApprovalRequestAuthority>;
    attempt!.withContext(() => {
      lifecycle = emitToolApprovalRequestAuthority({
        approvalId: invalidApprovalId,
        toolCallId: "call_invalid",
        toolName: "remove",
        input: {},
        attempt: attempt!,
      });
    });
    attempt!.end({ status: "suspended" });
    run.end({ status: "suspended" });
    await observe.flush();

    expect(lifecycle!).toBeUndefined();
    expect(observabilityDiagnostics().invalidRecords).toBe(1);
    expect(
      transport.records.filter(
        (record) =>
          record.type === "artifact" &&
          (record.kind === "approval.request" ||
            record.kind === "approval.decision"),
      ),
    ).toEqual([]);
  });
});
