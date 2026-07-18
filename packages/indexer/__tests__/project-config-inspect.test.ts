import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectProjectConfig } from "../src/indexer/project-config-inspect";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project config inspect", () => {
  it("uses the Eval product term in the discovered wire projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-config-inspect-"));
    roots.push(root);

    const inspect = await inspectProjectConfig({ root });
    const discovered = JSON.parse(JSON.stringify(inspect.discovered)) as Record<
      string,
      unknown
    >;

    expect(discovered).toHaveProperty("evals", 0);
    expect(discovered).not.toHaveProperty("evaluations");
  });
});
