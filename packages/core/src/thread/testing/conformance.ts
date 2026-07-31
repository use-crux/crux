/**
 * Shared conformance behaviors for Storage-backed Threads.
 *
 * Adapter authors run this suite unchanged so optimized implementations retain
 * the generic Thread's identity, grouping, branching, and consistency laws.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import {
  mutateRecord,
  type RecordStore,
  type Storage,
} from "../../storage";
import { thread } from "../thread";
import { registerThreadAlternativesConformance } from "./alternatives-conformance";
/** Options for {@link describeThreadConformance}. */
export interface DescribeThreadConformanceOptions {
  /** Human-readable implementation name used for the Vitest suite. */
  readonly name: string;
  /** Create a fresh isolated Storage bundle for each behavior. */
  readonly prepare: () => Storage | Promise<Storage>;
}
/**
 * Register the canonical Thread behavior suite.
 *
 * @param options - Name and fresh Storage factory for the implementation.
 *
 * @example
 * ```ts
 * describeThreadConformance({
 *   name: "my adapter",
 *   prepare: () => storage({ records: createRecordStore() }),
 * });
 * ```
 */
export function describeThreadConformance(
  options: DescribeThreadConformanceOptions,
): void {
  describe(`${options.name} Thread conformance`, () => {
    it("round-trips one message with generated identity and no variant metadata", async () => {
      const conversation = thread({
        id: "support-42",
        storage: await options.prepare(),
      });
      const commit = await conversation.append({
        role: "user",
        content: "Where is my order?",
      });
      expect(Object.isFrozen(conversation)).toBe(true);
      expect(Object.keys(conversation).sort()).toEqual([
        "_tag",
        "append",
        "commitTurn",
        "delete",
        "edit",
        "id",
        "read",
        "readHistory",
        "redact",
        "select",
      ]);
      expect(Object.isFrozen(commit)).toBe(true);
      expect(await conversation.read()).toEqual({
        threadId: "support-42",
        head: commit.messageIds[0],
        entries: [{
          kind: "message",
          id: commit.messageIds[0],
          createdAt: expect.any(String),
          role: "user",
          content: "Where is my order?",
        }],
      });
      expect((await conversation.read()).entries[0]).not.toHaveProperty("variant");
    });

    it("publishes a batch as one causal group in root-to-head order", async () => {
      const conversation = thread({
        id: "ordered-batch",
        storage: await options.prepare(),
      });
      const first = await conversation.append([
        { id: "user-1", role: "user", content: "Question" },
        { id: "assistant-1", role: "assistant", content: "Answer" },
      ]);
      const second = await conversation.append({
        id: "user-2",
        role: "user",
        content: "Follow-up",
      });
      expect(first.messageIds).toEqual(["user-1", "assistant-1"]);
      expect(second.parentId).toBe("assistant-1");
      expect((await conversation.read()).entries).toMatchObject([
        { id: "user-1", content: "Question" },
        { id: "assistant-1", parentId: "user-1", content: "Answer" },
        { id: "user-2", parentId: "assistant-1", content: "Follow-up" },
      ]);
    });

    it("round-trips a provider-neutral tool call, result, and response", async () => {
      const conversation = thread({
        id: "tool-round",
        storage: await options.prepare(),
      });
      const messages = [
        {
          id: "assistant-call",
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "call-weather",
            toolName: "weather",
            input: { city: "Amsterdam" },
          }],
        },
        {
          id: "tool-result",
          role: "tool",
          content: "18°C",
          metadata: { toolCallId: "call-weather", toolName: "weather" },
        },
        {
          id: "assistant-response",
          role: "assistant",
          content: "It is 18°C.",
        },
      ] as const;
      await conversation.append(messages);
      expect((await conversation.read()).entries).toMatchObject(messages);
      await expect(conversation.append({
        id: "unmatched-call",
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "missing-result",
          toolName: "weather",
          input: {},
        }],
      })).rejects.toMatchObject({ code: "invalid_message" });
      await expect(conversation.append({
        id: "unmatched-result",
        role: "tool",
        content: "orphan",
        metadata: { toolCallId: "missing-call", toolName: "weather" },
      })).rejects.toMatchObject({ code: "invalid_message" });
    });

    it("reads exact prefixes and paginates without splitting causal groups", async () => {
      const conversation = thread({
        id: "group-pages",
        storage: await options.prepare(),
      });
      await conversation.append([
        { id: "a", role: "user", content: "a" },
        { id: "b", role: "assistant", content: "b" },
      ]);
      await conversation.append({ id: "c", role: "user", content: "c" });
      await conversation.append([
        { id: "d", role: "user", content: "d" },
        { id: "e", role: "assistant", content: "e" },
        { id: "f", role: "user", content: "f" },
      ]);
      const newest = await conversation.read({ limit: 2 });
      expect(newest.entries.map(({ id }) => id)).toEqual(["d", "e", "f"]);
      expect(newest.cursor).toBe("d");
      const middle = await conversation.read({ before: newest.cursor, limit: 2 });
      expect(middle.entries.map(({ id }) => id)).toEqual(["c"]);
      const oldest = await conversation.read({ before: middle.cursor, limit: 2 });
      expect(oldest.entries.map(({ id }) => id)).toEqual(["a", "b"]);
      expect(oldest).not.toHaveProperty("cursor");
      const prefix = await conversation.read({ at: "e" });
      expect(prefix.entries.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("replays caller ids only for identical content at the identical position", async () => {
      const conversation = thread({
        id: "stable-replay",
        storage: await options.prepare(),
      });
      const input = { id: "user-1", role: "user", content: "Hello" } as const;
      const original = await conversation.append(input);
      await expect(conversation.append(input)).resolves.toEqual({
        ...original,
        replayed: true,
      });
      await expect(
        conversation.append({ ...input, content: "Changed" }),
      ).rejects.toMatchObject({ code: "identity_conflict" });
      await expect(
        conversation.append({ id: "user-1", role: "assistant", content: "Hello" }),
      ).rejects.toMatchObject({ code: "identity_conflict" });
      await conversation.append({ id: "user-2", role: "user", content: "Next" });
      await expect(
        conversation.append(input, { after: "user-2" }),
      ).rejects.toMatchObject({ code: "identity_conflict" });
      const batch = [
        { id: "batch-user", role: "user", content: "Question" },
        { id: "batch-assistant", role: "assistant", content: "Answer" },
      ] as const;
      await conversation.append(batch);
      await expect(conversation.append([
        batch[0],
        { id: "different-tail", role: "assistant", content: "Answer" },
      ])).rejects.toMatchObject({ code: "identity_conflict" });
    });

    it("preserves concurrent appends as one selected path and one durable alternative", async () => {
      const conversation = thread({
        id: "concurrent-branches",
        storage: await options.prepare(),
      });
      const left = { id: "left", role: "user", content: "Left" } as const;
      const right = { id: "right", role: "user", content: "Right" } as const;
      const receipts = await Promise.all([
        conversation.append(left),
        conversation.append(right),
      ]);
      const selected = receipts.find(({ status }) => status === "selected")!;
      const alternative = receipts.find(({ status }) => status === "alternative")!;

      expect(receipts.map(({ status }) => status).sort()).toEqual([
        "alternative",
        "selected",
      ]);
      expect((await conversation.read()).head).toBe(selected.selectedHead);
      expect((await conversation.read({ at: alternative.messageIds[0] })).head)
        .toBe(alternative.messageIds[0]);
      await conversation.append({
        id: "selected-follow-up",
        role: "assistant",
        content: "Continue selected",
      });
      for (const [input, receipt] of [
        [left, receipts[0]],
        [right, receipts[1]],
      ] as const) {
        await expect(conversation.append(input)).resolves.toEqual({
          ...receipt,
          replayed: true,
        });
      }
    });

    it("accepts group-ending append targets and rejects targets inside a group", async () => {
      const conversation = thread({
        id: "append-boundaries",
        storage: await options.prepare(),
      });
      await conversation.append([
        { id: "group-start", role: "user", content: "Question" },
        { id: "group-end", role: "assistant", content: "Answer" },
      ]);
      const selected = await conversation.append({
        id: "selected-next",
        role: "user",
        content: "Selected continuation",
      });
      await expect(conversation.append(
        { id: "invalid-split", role: "assistant", content: "No" },
        { after: "group-start" },
      )).rejects.toMatchObject({ code: "invalid_group" });
      const branch = await conversation.append(
        { id: "valid-branch", role: "user", content: "Alternative" },
        { after: "group-end" },
      );
      expect(branch).toMatchObject({
        status: "alternative",
        parentId: "group-end",
        selectedHead: selected.selectedHead,
      });
    });

    it("rejects a store that cannot read its own published control mutation", async () => {
      const backing = (await options.prepare()).records;
      let hiddenControlReads = 0;
      const records: RecordStore = {
        ...backing,
        async get(key) {
          if (key === "thread/eventual" && hiddenControlReads > 0) {
            hiddenControlReads -= 1;
            return null;
          }
          return backing.get(key);
        },
        async mutate(key, fn) {
          const value = await mutateRecord(backing, key, fn);
          hiddenControlReads = 8;
          return value;
        },
        capabilities: () => ({
          ...backing.capabilities(),
          mutate: "native",
        }),
      };
      const conversation = thread({ id: "eventual", storage: { records } });
      await expect(
        conversation.append({ role: "user", content: "Hello" }),
      ).rejects.toMatchObject({
        code: "unsupported_capability",
        message: expect.stringMatching(/config\.storage.*strongly consistent/u),
      });
    });
    registerThreadAlternativesConformance(options);
  });
}
