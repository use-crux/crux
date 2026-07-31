/**
 * Shared internal-removal behaviors for Storage-backed Threads.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { RecordStore } from "../../storage";
import { removeThreadGroup } from "../remove";
import { thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register causal-group visibility removal behaviors. */
export function registerThreadRemovalConformance(
  options: ErasureConformanceOptions,
): void {
  it("renders removed groups structurally and omits them from managed history", async () => {
    const storage = await options.prepare();
    const conversation = thread({ id: "removed-projection", storage });
    const removedGroup = [
      { id: "removed-user", role: "user", content: "Question" },
      { id: "removed-answer", role: "assistant", content: "Answer" },
    ] as const;
    const original = await conversation.append(removedGroup);
    await conversation.append({
      id: "kept-user",
      role: "user",
      content: "Keep this",
    });

    await removeThreadGroup(storage, conversation.id, "removed-user");

    expect((await conversation.read()).entries).toMatchObject([
      { kind: "removed", id: "removed-user" },
      { kind: "removed", id: "removed-answer", parentId: "removed-user" },
      {
        kind: "message",
        id: "kept-user",
        parentId: "removed-answer",
        content: "Keep this",
      },
    ]);
    expect(await conversation.readHistory()).toEqual({
      head: "kept-user",
      revision: expect.any(String),
      messages: [{ role: "user", content: "Keep this" }],
      messageIds: ["kept-user"],
    });
    await expect(conversation.append(removedGroup)).resolves.toEqual({
      ...original,
      replayed: true,
    });
  });

  it("never lets a delayed removal restore redacted provenance", async () => {
    const storage = await options.prepare();
    const backing = storage.records;
    let releaseRemoval = (): void => {};
    let markRemovalStarted = (): void => {};
    const removalStarted = new Promise<void>((resolve) => {
      markRemovalStarted = resolve;
    });
    const removalRelease = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let blockRemoval = true;
    const records: RecordStore = {
      ...backing,
      async mutate(key, fn) {
        if (blockRemoval && key.endsWith("/node/secret")) {
          blockRemoval = false;
          markRemovalStarted();
          await removalRelease;
        }
        return backing.mutate!(key, fn);
      },
    };
    const conversation = thread({
      id: "monotonic-erasure",
      storage: { ...storage, records },
    });
    await conversation.append({
      id: "secret",
      role: "user",
      content: "Never restore",
      metadata: { private: true },
    });

    const removal = removeThreadGroup(
      { ...storage, records },
      conversation.id,
      "secret",
    );
    await removalStarted;
    await conversation.redact("secret");
    releaseRemoval();
    await removal;

    expect(await backing.get("thread/monotonic-erasure/node/secret")).toEqual({
      schema: 1,
      id: "secret",
      parentId: null,
      groupId: expect.any(String),
      seq: 0,
      groupEnd: true,
      state: "redacted",
    });
  });
}
