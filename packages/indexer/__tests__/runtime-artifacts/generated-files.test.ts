import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitRuntimeArtifactPlan,
  createRuntimeArtifactPlan,
  preflightRuntimeArtifactPlan,
  RuntimeArtifactCommitError,
} from "../../src/indexer/runtime-artifacts/generated-files";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "crux-artifact-plan-"));
  roots.push(root);
  return root;
}

describe("Runtime artifact plan", () => {
  it("rejects non-canonical destinations before preflight", async () => {
    const root = await fixtureRoot();

    expect(() =>
      createRuntimeArtifactPlan({
        root,
        files: [
          {
            destination: "../outside.ts",
            contents: "unsafe\n",
            ownership: "crux-owned",
            activationOrder: 0,
          },
        ],
      }),
    ).toThrow(/unsafe.*canonical and root-relative/i);
  });

  it("does not write any destination when preflight cannot read one", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "first.txt"), "old-first\n");
    await mkdir(join(root, "blocked.txt"));
    const plan = createRuntimeArtifactPlan({
      root,
      files: [
        {
          destination: "first.txt",
          contents: "new-first\n",
          ownership: "crux-owned",
          activationOrder: 0,
        },
        {
          destination: "blocked.txt",
          contents: "new-blocked\n",
          ownership: "crux-owned",
          activationOrder: 1,
        },
      ],
    });

    await expect(preflightRuntimeArtifactPlan(plan)).rejects.toMatchObject({
      code: expect.stringMatching(/EISDIR|EACCES/),
    });
    await expect(readFile(join(root, "first.txt"), "utf8")).resolves.toBe(
      "old-first\n",
    );
  });

  it("rolls back activated files and reports them when a later rename fails", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "first.txt"), "old-first\n");
    await writeFile(join(root, "second.txt"), "old-second\n");
    await writeFile(join(root, "manifest.json"), "old-manifest\n");
    const prepared = await preflightRuntimeArtifactPlan(
      createRuntimeArtifactPlan({
        root,
        files: [
          {
            destination: "first.txt",
            contents: "new-first\n",
            ownership: "crux-owned",
            activationOrder: 10,
          },
          {
            destination: "second.txt",
            contents: "new-second\n",
            ownership: "crux-owned",
            activationOrder: 20,
          },
          {
            destination: "manifest.json",
            contents: "new-manifest\n",
            ownership: "crux-owned",
            activationOrder: Number.MAX_SAFE_INTEGER,
          },
        ],
      }),
    );
    await rm(join(root, "second.txt"));
    await mkdir(join(root, "second.txt"));

    const failure = await commitRuntimeArtifactPlan(prepared).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RuntimeArtifactCommitError);
    expect(failure).toMatchObject({
      activatedFiles: ["first.txt"],
      rollbackFailures: [],
    });
    await expect(readFile(join(root, "first.txt"), "utf8")).resolves.toBe(
      "old-first\n",
    );
    await expect(readFile(join(root, "manifest.json"), "utf8")).resolves.toBe(
      "old-manifest\n",
    );
    expect(
      (await readdir(root)).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
  });
});
