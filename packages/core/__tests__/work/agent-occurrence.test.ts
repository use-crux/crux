import { describe, expect, it } from "vitest";
import {
  createAgentToolOccurrenceRegistry,
  encodeOccurrenceKey,
} from "../../src/work/internal/agent-occurrence";

describe("Agent-tool occurrence identity", () => {
  it("replays the same occurrence and rejects conflicting input", () => {
    const registry = createAgentToolOccurrenceRegistry();
    const key = {
      ownerId: "parent",
      turnId: "turn_1",
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
        ownerId: "parent",
        turnId: "",
        toolCallId: "call_1",
        bindingKey: "research",
      },
      { topic: "same" },
      "work_1",
    );
    const second = registry.accept(
      {
        ownerId: "parent",
        turnId: "",
        toolCallId: "call_2",
        bindingKey: "research",
      },
      { topic: "same" },
      "work_2",
    );

    expect(first.workId).toBe("work_1");
    expect(second.workId).toBe("work_2");
  });
});
