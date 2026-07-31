/**
 * Shared alternative-navigation behaviors for Storage-backed Threads.
 *
 * Kept separate from core append/read behaviors so the public conformance
 * factory stays small while every implementation runs the same branch laws.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { Storage } from "../../storage";
import { thread } from "../thread";
import { registerThreadAlternativesEdgeConformance } from "./alternatives-edge-conformance";

interface AlternativesConformanceOptions {
  readonly prepare: () => Storage | Promise<Storage>;
}

/** Register immutable edit, selection, and variant navigation behaviors. */
export function registerThreadAlternativesConformance(
  options: AlternativesConformanceOptions,
): void {
  it("edits a user message as a new selected sibling without changing the original branch", async () => {
    const conversation = thread({
      id: "immutable-edit",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "original-user",
      role: "user",
      content: "Original question",
    });
    await conversation.append({
      id: "original-answer",
      role: "assistant",
      content: "Original answer",
    });

    const commit = await conversation.edit("original-user", {
      id: "edited-user",
      content: "Edited question",
      metadata: { source: "editor" },
    });

    expect(commit).toMatchObject({
      status: "selected",
      messageIds: ["edited-user"],
      selectedHead: "edited-user",
      replayed: false,
    });
    expect((await conversation.read()).entries).toMatchObject([{
      id: "edited-user",
      role: "user",
      content: "Edited question",
      metadata: { source: "editor" },
    }]);
    expect(
      (await conversation.read({ at: "original-answer" })).entries,
    ).toMatchObject([
      {
        id: "original-user",
        role: "user",
        content: "Original question",
      },
      {
        id: "original-answer",
        role: "assistant",
        content: "Original answer",
      },
    ]);
  });

  it("selects a sibling with its remembered continuation", async () => {
    const conversation = thread({
      id: "remembered-selection",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "original-user",
      role: "user",
      content: "Original question",
    });
    await conversation.append({
      id: "original-answer",
      role: "assistant",
      content: "Original answer",
    });
    await conversation.edit("original-user", {
      id: "edited-user",
      content: "Edited question",
    });
    await conversation.append({
      id: "edited-answer",
      role: "assistant",
      content: "Edited answer",
    });

    const original = await conversation.select("original-user");
    expect(original.head).toBe("original-answer");
    expect(original.entries.map(({ id }) => id)).toEqual([
      "original-user",
      "original-answer",
    ]);

    const edited = await conversation.select("edited-user");
    expect(edited.head).toBe("edited-answer");
    expect(edited.entries.map(({ id }) => id)).toEqual([
      "edited-user",
      "edited-answer",
    ]);
  });

  it("adds deterministic navigation metadata only to sibling group starts", async () => {
    const conversation = thread({
      id: "variant-navigation",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "a-original",
      role: "user",
      content: "Original",
    });
    await conversation.edit("a-original", {
      id: "b-edited",
      content: "Edited",
    });
    await conversation.append({
      id: "edited-answer",
      role: "assistant",
      content: "Answer",
    });

    expect((await conversation.read()).entries).toMatchObject([
      {
        id: "b-edited",
        variant: {
          index: 1,
          count: 2,
          previous: "a-original",
        },
      },
      { id: "edited-answer" },
    ]);
    expect((await conversation.read()).entries[1]).not.toHaveProperty("variant");
    expect((await conversation.read({ at: "a-original" })).entries[0])
      .toMatchObject({
        id: "a-original",
        variant: {
          index: 0,
          count: 2,
          next: "b-edited",
        },
      });
  });

  it("represents assistant regeneration as a selectable sibling append", async () => {
    const conversation = thread({
      id: "assistant-regeneration",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "user",
      role: "user",
      content: "Question",
    });
    await conversation.append({
      id: "a-original",
      role: "assistant",
      content: "Original answer",
    });

    const regenerated = await conversation.append(
      {
        id: "b-regenerated",
        role: "assistant",
        content: "Regenerated answer",
      },
      { after: "user" },
    );

    expect(regenerated).toMatchObject({
      status: "alternative",
      parentId: "user",
      selectedHead: "a-original",
    });
    expect((await conversation.read()).entries[1]).toMatchObject({
      id: "a-original",
      variant: { index: 0, count: 2, next: "b-regenerated" },
    });
    expect(await conversation.select("b-regenerated")).toMatchObject({
      head: "b-regenerated",
      entries: [
        { id: "user" },
        {
          id: "b-regenerated",
          role: "assistant",
          content: "Regenerated answer",
          variant: { index: 1, count: 2, previous: "a-original" },
        },
      ],
    });
  });

  registerThreadAlternativesEdgeConformance(options);
}
