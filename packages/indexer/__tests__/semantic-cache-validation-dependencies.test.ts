import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/indexer/cache-identity";
import {
  createSemanticCacheValidationDependencyCollector,
  validateSemanticCacheDependencies,
} from "../src/indexer/semantic/cache-validation";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic cache validation dependencies", () => {
  it("validates only the recorded exact path and bytes", async () => {
    const root = await fixtureRoot();
    const manifest = join(root, "selected/package.json");
    await mkdir(join(root, "selected"), { recursive: true });
    await writeFile(manifest, JSON.stringify({ name: "@use-crux/core" }));
    const dependency = {
      file: manifest,
      digest: sha256(await readFile(manifest)),
    };

    await expect(validateSemanticCacheDependencies([dependency])).resolves.toBe(
      true,
    );
    await writeFile(manifest, JSON.stringify({ name: "@use-crux/lookalike" }));
    await expect(validateSemanticCacheDependencies([dependency])).resolves.toBe(
      false,
    );
  });

  it.each(["missing", "unreadable"] as const)(
    "fails closed when a recorded dependency is %s",
    async (state) => {
      const root = await fixtureRoot();
      const manifest = join(root, "selected/package.json");
      await mkdir(join(root, "selected"), { recursive: true });
      if (state === "unreadable") {
        await mkdir(manifest);
      }

      await expect(
        validateSemanticCacheDependencies([
          { file: manifest, digest: "0".repeat(64) },
        ]),
      ).resolves.toBe(false);
    },
  );

  it("deduplicates and sorts exact dependencies deterministically", () => {
    const collector = createSemanticCacheValidationDependencyCollector();
    collector.record({ file: "/z/package.json", digest: "1".repeat(64) });
    collector.record({ file: "/a/package.json", digest: "2".repeat(64) });
    collector.record({ file: "/z/package.json", digest: "3".repeat(64) });

    expect(collector.values()).toEqual([
      { file: "/a/package.json", digest: "2".repeat(64) },
      { file: "/z/package.json", digest: "3".repeat(64) },
    ]);
  });

  it("marks unrecordable validation evidence as uncacheable", () => {
    const collector = createSemanticCacheValidationDependencyCollector();
    expect(collector.cacheable()).toBe(true);
    collector.invalidate();
    expect(collector.cacheable()).toBe(false);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-cache-validation-"),
  );
  roots.push(root);
  return root;
}
