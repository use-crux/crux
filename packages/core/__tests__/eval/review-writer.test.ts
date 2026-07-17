import { open, readFile, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { addReviewCase } from "../../src/eval/node/runner";
import { resolveReviewSidecar } from "../../src/eval/node/review/filesystem";

const root = dirname(
  fileURLToPath(
    new URL("./fixtures/node-run-project/package.json", import.meta.url),
  ),
);
const sidecar = join(root, "evals/review.cases.jsonl");

describe.sequential("Review repository writer", () => {
  afterEach(async () => {
    await rm(sidecar, { force: true });
    await rm(`${sidecar}.lock`, { force: true });
  });

  it("prefills input/call only and requires an explicit correction save", async () => {
    const pending = await addReviewCase({
      projectRoot: root,
      evalId: "review",
      id: "review-1",
      input: { question: "new" },
      call: { temperature: 0 },
      correctionProposal: "corrected",
      reviewId: "rv_1",
      runId: "run_1",
      repositoryWritable: false,
      now: () => new Date("2026-07-17T00:00:00.000Z"),
    });

    expect(pending).toMatchObject({
      status: "pending-sync",
      path: "evals/review.cases.jsonl",
      unvalidatedExpected: false,
    });
    expect(JSON.parse(pending.row)).not.toHaveProperty("expected");
    await expect(
      addReviewCase({
        projectRoot: root,
        evalId: "review",
        id: "bad",
        input: { question: "new" },
        saveCorrection: true,
        reviewId: "rv_1",
        runId: "run_1",
      }),
    ).rejects.toThrow(/saveCorrection.*correctionProposal/);
  });

  it("validates, appends canonically, verifies rediscovery, and semantically links", async () => {
    const request = {
      projectRoot: root,
      evalId: "review",
      id: "review-2",
      input: { question: "correct me" },
      correctionProposal: "corrected",
      saveCorrection: true,
      reviewId: "rv_2",
      runId: "run_2",
      now: () => new Date("2026-07-17T00:00:00.000Z"),
    } as const;
    const added = await addReviewCase(request);
    expect(added).toMatchObject({ status: "added", unvalidatedExpected: true });
    expect(await readFile(sidecar, "utf8")).toBe(added.row);

    const linked = await addReviewCase({ ...request, id: "different-id" });
    expect(linked).toMatchObject({ status: "linked", caseId: "review-2" });
    expect((await readFile(sidecar, "utf8")).trim().split("\n")).toHaveLength(
      1,
    );
  });

  it("returns ID conflicts without overwriting and rejects invalid input", async () => {
    await expect(
      addReviewCase({
        projectRoot: root,
        evalId: "review",
        id: "invalid",
        input: { question: 42 } as never,
        reviewId: "rv_3",
        runId: "run_3",
      }),
    ).rejects.toThrow(/input failed schema validation/i);
    const conflict = await addReviewCase({
      projectRoot: root,
      evalId: "review",
      id: "existing",
      input: { question: "different" },
      reviewId: "rv_3",
      runId: "run_3",
    });
    expect(conflict.status).toBe("conflict");
    await expect(readFile(sidecar)).rejects.toThrow();
  });

  it("does not write through a held lock and rejects escaped generated paths", async () => {
    const lock = await open(`${sidecar}.lock`, "wx");
    try {
      await expect(
        addReviewCase({
          projectRoot: root,
          evalId: "review",
          id: "locked",
          input: { question: "locked" },
          reviewId: "rv_4",
          runId: "run_4",
        }),
      ).rejects.toThrow(/holds the sidecar lock/i);
    } finally {
      await lock.close();
    }
    await expect(
      resolveReviewSidecar(root, "../escape.cases.jsonl"),
    ).rejects.toThrow(/inside.*project root/i);
  });

  it("rejects a sibling sidecar symlink that escapes the real project root", async () => {
    const outside = join(dirname(root), "escaped-review.cases.jsonl");
    await rm(outside, { force: true });
    await symlink(outside, sidecar);
    try {
      await expect(
        addReviewCase({
          projectRoot: root,
          evalId: "review",
          id: "escaped",
          input: { question: "escaped" },
          reviewId: "rv_5",
          runId: "run_5",
        }),
      ).rejects.toThrow(/inside.*project root/i);
    } finally {
      await rm(sidecar, { force: true });
      await rm(outside, { force: true });
    }
  });
});
