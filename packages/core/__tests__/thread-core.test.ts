import { describe, expect, expectTypeOf, it } from "vitest";
import type { Message } from "../src/generation/messages";
import { inMemoryStorage } from "../src/storage";
import {
  thread,
  type ThreadEntry,
  type ThreadMessage,
} from "../src/thread";
import { describeThreadConformance } from "../src/thread/testing/vitest";

describeThreadConformance({
  name: "in-memory",
  prepare: inMemoryStorage,
});

describe("thread public surface", () => {
  it("narrows live entries to the canonical role-restricted Message union", () => {
    const entry = null as ThreadEntry | null;
    if (entry?.kind === "message") {
      expectTypeOf(entry).toMatchTypeOf<Message>();
      expectTypeOf(entry).toMatchTypeOf<ThreadMessage>();
      if (entry.role !== "assistant") {
        // @ts-expect-error Tool calls are assistant-only canonical content.
        entry.content = [{
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "lookup",
          input: {},
        }];
      }
    }
    expect(entry).toBeNull();
  });

  it("exports the reusable conformance factory", () => {
    expect(describeThreadConformance).toBeTypeOf("function");
    expect(thread).toBeTypeOf("function");
  });
});
