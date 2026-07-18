import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { importUserModule } from "../src/indexer/imports";

describe("project TypeScript imports", () => {
  it("does not require projects to install the Indexer's TS loader", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-indexer-import-"));
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    const source = join(root, "fixture.ts");
    await writeFile(source, "export const answer: number = 42\n");

    await expect(importUserModule(source, 5_000)).resolves.toMatchObject({
      answer: 42,
    });
  });

  it("does not rewrite imports outside an authored import session", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-indexer-unscoped-"));
    const source = join(root, "ordinary.mjs");
    await writeFile(source, "export const url = import.meta.url\n");
    const sourceURL = pathToFileURL(source).href;
    const imported = (await import(sourceURL)) as { readonly url: string };

    expect(imported.url).not.toContain("cruxImport=");
  });
});
