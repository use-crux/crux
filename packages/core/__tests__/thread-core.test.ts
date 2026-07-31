import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { Message } from "../src/generation/messages";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../src/observability";
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
  afterEach(() => {
    resetObservabilityRuntime();
  });

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

  it("emits payload-safe evidence for every public Thread operation", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const conversation = thread({
      id: "observable-thread",
      storage: inMemoryStorage(),
    });
    const appended = await conversation.append({
      id: "original",
      role: "user",
      content: "private append content",
    });
    await conversation.read();
    const edited = await conversation.edit("original", {
      id: "replacement",
      content: "private edit content",
    });
    await conversation.select("original");
    await conversation.redact("replacement");
    await conversation.delete();
    await observe.flush();

    const events = transport.records.filter(
      (record) => record.type === "span:event",
    );
    expect(events.map(({ name }) => name)).toEqual([
      "thread.append",
      "thread.read",
      "thread.edit",
      "thread.select",
      "thread.redact",
      "thread.delete",
    ]);
    expect(
      transport.records.find(
        (record) =>
          record.type === "span:start" && record.name === "thread.append",
      ),
    ).toMatchObject({
      family: "thread",
      primitive: "thread.operation",
      definitionRefs: [
        {
          id: "thread:observable-thread",
          kind: "thread",
          role: "invoked-thread",
        },
      ],
    });
    expect(events[0]).toMatchObject({
      attributes: {
        threadId: "observable-thread",
        operation: "append",
        roles: ["user"],
        messageCount: 1,
        messageIds: appended.messageIds,
        decision: appended.status,
      },
    });
    expect(events[2]).toMatchObject({
      attributes: {
        threadId: "observable-thread",
        operation: "edit",
        targetId: "original",
        messageIds: edited.messageIds,
      },
    });
    expect(events[4]).toMatchObject({
      attributes: {
        threadId: "observable-thread",
        operation: "redact",
        messageIds: ["replacement"],
        state: "redacted",
      },
    });
    expect(events[5]).toMatchObject({
      attributes: {
        threadId: "observable-thread",
        operation: "delete",
        state: "deleted",
      },
    });
    expect(JSON.stringify(events)).not.toContain("private append content");
    expect(JSON.stringify(events)).not.toContain("private edit content");
  });
});
