import { describe, expect, it } from "vitest";
import {
  createAgentToolOccurrenceRegistry,
  createOwnerExecutionId,
  encodeOccurrenceKey,
  resolveAgentToolTurnId,
} from "../../src/work/internal/agent-occurrence";

describe("Agent-tool occurrence identity", () => {
  it("replays the same occurrence and rejects conflicting input", () => {
    const registry = createAgentToolOccurrenceRegistry();
    const key = {
      ownerId: "owner_exec_1",
      turnId: "hist:2",
      toolCallId: "call_1",
      bindingKey: "research",
    };

    const first = registry.accept(key, { topic: "a" }, "work_1");
    const replay = registry.accept(key, { topic: "a" }, "work_2");

    expect(first.workId).toBe("work_1");
    expect(replay.workId).toBe("work_1");
    expect(registry.get(key)?.workId).toBe("work_1");
    expect(encodeOccurrenceKey(key)).toContain("call_1");

    expect(() => registry.accept(key, { topic: "b" }, "work_3")).toThrow(
      "Agent-tool occurrence identity was reused with conflicting input.",
    );
  });

  it("treats distinct tool calls as distinct occurrences", () => {
    const registry = createAgentToolOccurrenceRegistry();
    const first = registry.accept(
      {
        ownerId: "owner_exec_1",
        turnId: "hist:0",
        toolCallId: "call_1",
        bindingKey: "research",
      },
      { topic: "same" },
      "work_1",
    );
    const second = registry.accept(
      {
        ownerId: "owner_exec_1",
        turnId: "hist:0",
        toolCallId: "call_2",
        bindingKey: "research",
      },
      { topic: "same" },
      "work_2",
    );

    expect(first.workId).toBe("work_1");
    expect(second.workId).toBe("work_2");
  });

  it("isolates separate owner executions that reuse tool-call ids", () => {
    const registry = createAgentToolOccurrenceRegistry();
    const firstOwner = createOwnerExecutionId();
    const secondOwner = createOwnerExecutionId();
    expect(firstOwner).not.toBe(secondOwner);

    const first = registry.accept(
      {
        ownerId: firstOwner,
        turnId: "hist:0",
        toolCallId: "stable-call",
        bindingKey: "research",
      },
      { topic: "a" },
      "work_1",
    );
    const second = registry.accept(
      {
        ownerId: secondOwner,
        turnId: "hist:0",
        toolCallId: "stable-call",
        bindingKey: "research",
      },
      { topic: "a" },
      "work_2",
    );

    expect(first.workId).toBe("work_1");
    expect(second.workId).toBe("work_2");
  });

  it("derives turn identity from sealed history length", () => {
    expect(resolveAgentToolTurnId({})).toBe("hist:0");
    expect(resolveAgentToolTurnId({ messages: [] })).toBe("hist:0");
    expect(resolveAgentToolTurnId({ messages: [{ role: "user" }] })).toBe(
      "hist:1",
    );
  });

  it("releases owner partitions so later runs do not reconnect stale children", () => {
    const registry = createAgentToolOccurrenceRegistry();
    const ownerId = "owner_exec_release";
    const key = {
      ownerId,
      turnId: "hist:0",
      toolCallId: "stable-call",
      bindingKey: "research",
    };
    registry.accept(key, { topic: "a" }, "work_1");
    expect(registry.size()).toBe(1);

    registry.releaseOwner(ownerId);
    expect(registry.get(key)).toBeUndefined();
    expect(registry.size()).toBe(0);

    const next = registry.accept(key, { topic: "a" }, "work_2");
    expect(next.workId).toBe("work_2");
  });
});
