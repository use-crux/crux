import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
} from "../src/indexer/static-index/syntax";
import type { StaticFileExtraction } from "../src/indexer/static/extraction/engine";
import {
  assertStaticRepositoryInvariants,
  assertStaticRepositoryRunInvariants,
} from "./static-repository-invariants";

describe("static repository invariants", () => {
  it("accepts irrelevant indexed-source edits without a fixture refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-static-invariants-"));
    const file = join(root, "src", "prompt.ts");

    try {
      await mkdir(join(root, "src"));
      await writeFile(
        file,
        "export const greeting = prompt({ id: 'greeting' })\n",
      );
      const before = await assertStaticRepositoryInvariants(root, {
        syntaxFrontend: () => emptyFrontend,
      });

      await writeFile(
        file,
        "// An irrelevant source comment.\nexport const greeting = prompt({ id: 'greeting' })\n",
      );
      const after = await assertStaticRepositoryInvariants(root, {
        syntaxFrontend: () => emptyFrontend,
      });

      expect(before.files).toEqual(["src/prompt.ts"]);
      expect(after.files).toEqual(before.files);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts source-level warning diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-static-invariants-"));

    try {
      await writeCorpusFile(root);

      await expect(
        assertStaticRepositoryInvariants(root, {
          syntaxFrontend: () => ({
            ...emptyFrontend,
            parseFile: (input) => ({
              ...emptyRecord(input),
              diagnostics: [
                {
                  id: "fixture-warning",
                  severity: "warning",
                  code: "relation.unresolved_reference",
                  message: "Fixture reference is unresolved",
                  source: { file: input.file, line: 1, column: 1 },
                },
              ],
            }),
          }),
        }),
      ).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects error diagnostics and reports their code", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-static-invariants-"));

    try {
      await writeCorpusFile(root);

      await expect(
        assertStaticRepositoryInvariants(root, {
          syntaxFrontend: () => ({
            ...emptyFrontend,
            parseFile: (input) => ({
              ...emptyRecord(input),
              diagnostics: [
                {
                  id: "fixture-diagnostic",
                  severity: "error",
                  code: "index.fixture_failure",
                  message: "Fixture extraction failed",
                  source: { file: input.file, line: 1, column: 1 },
                },
              ],
            }),
          }),
        }),
      ).rejects.toThrow(/index\.fixture_failure/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires every safe selected path exactly once", () => {
    const root = "/repo";
    const first = emptyExtraction("/repo/src/first.ts");

    expect(() =>
      assertStaticRepositoryRunInvariants(
        root,
        [first.file, "/repo/src/second.ts"],
        [first, first],
      ),
    ).toThrow(/exactly once/);
  });

  it("accepts local dependency paths inside the root when discovery skips them", () => {
    const extraction = {
      ...emptyExtraction("/repo/src/prompt.ts"),
      dependencies: ["@acme/external", "/repo/src/helper.ts"],
    };

    expect(() =>
      assertStaticRepositoryRunInvariants(
        "/repo",
        [extraction.file],
        [extraction],
      ),
    ).not.toThrow();
  });

  it("rejects local dependency paths outside the repository root", () => {
    const extraction = {
      ...emptyExtraction("/repo/src/prompt.ts"),
      dependencies: ["@acme/external", "/outside/helper.ts"],
    };

    expect(() =>
      assertStaticRepositoryRunInvariants(
        "/repo",
        [extraction.file],
        [extraction],
      ),
    ).toThrow(/dependency.*outside\/helper\.ts/i);
  });
});

async function writeCorpusFile(root: string): Promise<void> {
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "prompt.ts"),
    "export const greeting = prompt({ id: 'greeting' })\n",
  );
}

const emptyFrontend: StaticSyntaxFrontend = {
  name: "oxc-rust",
  identity: { name: "oxc-rust", version: "repository-invariants-test" },
  parseFile: emptyRecord,
};

function emptyRecord(input: StaticSyntaxFileInput): StaticSyntaxFileRecord {
  return {
    schemaVersion: 1,
    frontend: emptyFrontend.identity,
    file: input.file,
    relativePath: input.file,
    sourceHash: createHash("sha256").update(input.source).digest("hex"),
    imports: [],
    matches: [],
    localInitializers: [],
    diagnostics: [],
  };
}

function emptyExtraction(file: string): StaticFileExtraction {
  return {
    file,
    definitions: [],
    relations: [],
    diagnostics: [],
    dependencies: [],
    fromCache: false,
  };
}
