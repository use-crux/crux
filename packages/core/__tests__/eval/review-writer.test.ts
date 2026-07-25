import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addReviewCase } from "../../src/eval/node/runner";
import { resolveReviewSidecar } from "../../src/eval/node/review/filesystem";

const fixtureRoot = dirname(
  fileURLToPath(
    new URL("./fixtures/node-run-project/package.json", import.meta.url),
  ),
);
let temporaryRoot: string;
let root: string;
let sidecar: string;

describe.sequential("Review repository writer", () => {
  beforeAll(async () => {
    // Created under the OS temp dir, never inside the repo: an interrupted run
    // (killed process, crashed worker) skips `afterAll` and would otherwise leave an
    // untracked fixture directory dirtying the worktree.
    temporaryRoot = await mkdtemp(join(tmpdir(), "crux-review-writer-"));
    root = temporaryRoot;
    await mkdir(join(root, "evals"), { recursive: true });
    // The fixtures import core through repo-relative paths, which only resolve at
    // their original depth. Rewrite those specifiers to absolute paths on copy so the
    // project is location-independent and can live outside the repo.
    const srcRoot = join(fixtureRoot, "../../../../src");
    const relocate = async (name: string): Promise<void> => {
      const source = await readFile(join(fixtureRoot, name), "utf8");
      await writeFile(
        join(root, name),
        source.replace(/(["'])(?:\.\.\/)+src\//g, `$1${srcRoot}/`),
        "utf8",
      );
    };
    await Promise.all([relocate("evals/review.eval.ts"), relocate("task.ts")]);
    sidecar = join(root, "evals/review.cases.jsonl");
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

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

  it("applies the internal persistence policy before producing a Review row", async () => {
    const pending = await addReviewCase(
      {
        projectRoot: root,
        evalId: "review",
        id: "review-private",
        input: { question: "private" },
        reviewId: "rv_private",
        runId: "run_private",
        repositoryWritable: false,
      },
      { persistencePolicy: { redactPaths: ["question"] } },
    );

    expect(JSON.parse(pending.row)).toMatchObject({
      input: { question: "[redacted]" },
    });
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
  }, 20_000);

  it("serializes concurrent semantic duplicates into one added and one linked Case", async () => {
    const request = {
      projectRoot: root,
      evalId: "review",
      input: { question: "concurrent duplicate" },
      reviewId: "rv_concurrent",
      runId: "run_concurrent",
      now: () => new Date("2026-07-17T00:00:00.000Z"),
    } as const;

    const results = await Promise.all([
      addReviewCase({ ...request, id: "concurrent-a" }),
      addReviewCase({ ...request, id: "concurrent-b" }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "added",
      "linked",
    ]);
    expect((await readFile(sidecar, "utf8")).trim().split("\n")).toHaveLength(
      1,
    );
  }, 15_000);

  it("serializes concurrent same-ID conflicts without appending both rows", async () => {
    const request = {
      projectRoot: root,
      evalId: "review",
      id: "concurrent-id",
      reviewId: "rv_concurrent_id",
      runId: "run_concurrent_id",
      now: () => new Date("2026-07-17T00:00:00.000Z"),
    } as const;

    const results = await Promise.all([
      addReviewCase({ ...request, input: { question: "first" } }),
      addReviewCase({ ...request, input: { question: "second" } }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "added",
      "conflict",
    ]);
    expect((await readFile(sidecar, "utf8")).trim().split("\n")).toHaveLength(
      1,
    );
  }, 15_000);

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
