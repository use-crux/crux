/**
 * Shared edge behaviors for Thread alternative navigation.
 *
 * These cases cover branch-tip advancement and typed rejection paths without
 * bloating the primary alternatives conformance module.
 *
 * @module
 */

import { expect, it } from "vitest";
import type { Storage } from "../../storage";
import { ThreadError } from "../errors";
import { thread } from "../thread";
import { registerThreadErasureConformance } from "./erasure-conformance";
import { registerThreadReceiptConformance } from "./receipt-conformance";

interface AlternativesEdgeConformanceOptions {
  readonly prepare: () => Storage | Promise<Storage>;
}

/** Register continuation and rejection behaviors for Thread alternatives. */
export function registerThreadAlternativesEdgeConformance(
  options: AlternativesEdgeConformanceOptions,
): void {
  it("keeps the group-ending continuation when selecting an active ancestor", async () => {
    const conversation = thread({
      id: "active-ancestor",
      storage: await options.prepare(),
    });
    await conversation.append([
      {
        id: "group-start",
        role: "user",
        content: "Question",
      },
      {
        id: "group-end",
        role: "assistant",
        content: "Answer",
      },
    ]);

    const selected = await conversation.select("group-start");
    expect(selected.head).toBe("group-end");
    expect(selected.entries.map(({ id }) => id)).toEqual([
      "group-start",
      "group-end",
    ]);

    const continuation = await conversation.append({
      id: "continuation",
      role: "user",
      content: "Follow-up",
    });
    expect(continuation.parentId).toBe("group-end");
  });

  it("restores a continuation appended while its sibling branch was selected", async () => {
    const conversation = thread({
      id: "background-continuation",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "root",
      role: "user",
      content: "Question",
    });
    await conversation.append({
      id: "selected-answer",
      role: "assistant",
      content: "Selected answer",
    });
    await conversation.append(
      {
        id: "alternative-answer",
        role: "assistant",
        content: "Alternative answer",
      },
      { after: "root" },
    );
    await conversation.append(
      {
        id: "alternative-follow-up",
        role: "user",
        content: "Alternative follow-up",
      },
      { after: "alternative-answer" },
    );

    const selected = await conversation.select("alternative-answer");
    expect(selected.head).toBe("alternative-follow-up");
    expect(selected.entries.map(({ id }) => id)).toEqual([
      "root",
      "alternative-answer",
      "alternative-follow-up",
    ]);
  });

  it("edits a published message without requiring its branch to be selected first", async () => {
    const conversation = thread({
      id: "edit-unselected",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "original-user",
      role: "user",
      content: "Original",
    });
    await conversation.append({
      id: "original-answer",
      role: "assistant",
      content: "Original answer",
    });
    await conversation.edit("original-user", {
      id: "first-edit",
      content: "First edit",
    });

    await expect(conversation.edit("original-user", {
      id: "second-edit",
      content: "Second edit",
    })).resolves.toMatchObject({
      status: "selected",
      messageIds: ["second-edit"],
      selectedHead: "second-edit",
    });
    await expect(conversation.select("original-user")).resolves.toMatchObject({
      head: "original-answer",
    });
    await expect(conversation.select("first-edit")).resolves.toMatchObject({
      head: "first-edit",
    });
  });

  it("recognizes a concurrent identical edit as a replay", async () => {
    const conversation = thread({
      id: "concurrent-edit-replay",
      storage: await options.prepare(),
    });
    await conversation.append({
      id: "original",
      role: "user",
      content: "Original",
    });
    const patch = {
      id: "replacement",
      content: "Replacement",
    } as const;

    const receipts = await Promise.all([
      conversation.edit("original", patch),
      conversation.edit("original", patch),
    ]);

    expect(receipts.map(({ replayed }) => replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(receipts[1]).toEqual({
      ...receipts[0],
      replayed: !receipts[0]!.replayed,
    });
  });

  it("keeps append replay receipts stable after branch navigation", async () => {
    const conversation = thread({
      id: "stable-navigation-replay",
      storage: await options.prepare(),
    });
    const input = {
      id: "original",
      role: "user",
      content: "Original",
    } as const;
    const original = await conversation.append(input);
    await conversation.edit("original", {
      id: "edited",
      content: "Edited",
    });

    await expect(conversation.append(input)).resolves.toEqual({
      ...original,
      replayed: true,
    });
    expect((await conversation.read()).head).toBe("edited");
  });

  it("rejects missing edit targets and invalid alternative operations with typed errors", async () => {
    const conversation = thread({
      id: "invalid-alternatives",
      storage: await options.prepare(),
    });
    const missing = await conversation.edit("missing", {
      content: "Replacement",
    }).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(ThreadError);
    expect(missing).toMatchObject({ code: "not_found" });

    await conversation.append({
      id: "root",
      role: "user",
      content: "Question",
    });
    await conversation.append({
      id: "selected-answer",
      role: "assistant",
      content: "Selected answer",
    });
    await expect(conversation.edit("selected-answer", {
      content: "Replacement",
    })).rejects.toMatchObject({ code: "invalid_group" });

    await conversation.append(
      {
        id: "alternative-answer",
        role: "assistant",
        content: "Alternative answer",
      },
      { after: "root" },
    );
    await conversation.append(
      {
        id: "alternative-follow-up",
        role: "user",
        content: "Alternative follow-up",
      },
      { after: "alternative-answer" },
    );
    await expect(
      conversation.select("alternative-follow-up"),
    ).rejects.toMatchObject({ code: "invalid_group" });

    // Redacted edit targets join this suite when redact() is public.
  });

  registerThreadReceiptConformance(options);
  registerThreadErasureConformance(options);
}
