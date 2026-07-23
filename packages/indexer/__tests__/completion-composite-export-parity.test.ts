import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect } from "vitest";
import type { IndexPatch, IndexPatchState } from "../src/indexer/patches";
import { applyIndexPatch, emptyIndexPatchState } from "../src/indexer/patches";
import { createSemanticIndexService } from "../src/indexer/semantic/service";
import { createNativeSemanticBackend } from "../src/indexer/semantic/backends/tsgo";
import { createTypeScriptSemanticBackend } from "../src/indexer/semantic/backends/typescript";
import { createStaticExtraction } from "../src/indexer/static/extraction/engine";
import { createRustOxcStaticSyntaxFrontend } from "../src/testing/rust-oxc-frontend";
import { itWithRustOxc } from "./native-first-party-fixture-helpers";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("completion composite export parity", () => {
  itWithRustOxc(
    "preserves module-qualified static export proof under both semantic backends",
    async () => {
      const { file, root } = await writeFixture();
      const staticFacts = await createStaticExtraction({
        root,
        cache: "none",
        syntaxFrontend: createRustOxcStaticSyntaxFrontend({
          callNames: ["agent", "prompt"],
        }),
      }).extractFile(file);
      const astPatch = staticPatch(root, staticFacts);
      const base = applyIndexPatch(emptyIndexPatchState(), astPatch);

      const [typescriptPatch, nativePatch] = await Promise.all([
        createSemanticIndexService({
          backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
        }).indexFiles({ root, files: [file] }),
        createSemanticIndexService({
          backend: createNativeSemanticBackend({ cache: "disabled" }),
        }).indexFiles({ root, files: [file] }),
      ]);

      expect(typescriptPatch.status).toBe("ok");
      expect(nativePatch.status).toBe("ok");
      const typescriptComposite = applyIndexPatch(base, typescriptPatch);
      const nativeComposite = applyIndexPatch(base, nativePatch);
      expect(exportEvidence(nativeComposite)).toEqual(
        exportEvidence(typescriptComposite),
      );
      expect(exportEvidence(nativeComposite)).toEqual([
        { id: "agent:impostor", exported: undefined },
        { id: "agent:reviewer", exported: true },
        { id: "prompt:writer", exported: true },
      ]);
    },
    30_000,
  );
});

async function writeFixture(): Promise<{
  readonly file: string;
  readonly root: string;
}> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-completion-composite-parity-"),
  );
  roots.push(root);
  const file = join(root, "src/fixture.ts");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
  await symlink(
    join(process.cwd(), "../core"),
    join(root, "node_modules/@use-crux/core"),
    "dir",
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  await writeFile(
    file,
    `
      import { prompt } from '@use-crux/core'
      import { agent as cruxAgent } from '@use-crux/core/agent'

      function agent(config: { id: string }) {
        return config
      }

      export const writer = prompt({ id: 'writer' })
      export const reviewer = cruxAgent({ id: 'reviewer', prompt: writer })
      export const impostor = agent({ id: 'impostor' })
    `,
  );
  return { file, root };
}

function staticPatch(
  root: string,
  facts: Awaited<
    ReturnType<ReturnType<typeof createStaticExtraction>["extractFile"]>
  >,
): IndexPatch {
  return {
    schemaVersion: 1,
    phase: "ast",
    project: { root },
    startedAt: "2026-07-23T00:00:00.000Z",
    status: "ok",
    facts: {
      definitions: facts.definitions,
      relations: facts.relations,
      diagnostics: facts.diagnostics,
    },
  };
}

function exportEvidence(state: IndexPatchState) {
  return state.definitions
    .filter((definition) =>
      ["agent:impostor", "agent:reviewer", "prompt:writer"].includes(
        definition.id,
      ),
    )
    .map((definition) => ({
      id: definition.id,
      exported: definition.metadata?.["exported"],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
