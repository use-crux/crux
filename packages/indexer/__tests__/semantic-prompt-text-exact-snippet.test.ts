import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic prompt-text exact snippets", () => {
  it.each(["typescript", "native"] as const)(
    "retains an unbounded tagged expression with the %s backend",
    async (backendName) => {
      const body = "x".repeat(12_100);
      const tag = `md\`${body}\``;
      const root = await fixtureRoot(tag);
      const file = join(root, "src/index.ts");
      const patch = await createSemanticIndexService({
        backend:
          backendName === "typescript"
            ? createTypeScriptSemanticBackend({ cache: "disabled" })
            : createNativeSemanticBackend({ cache: "disabled" }),
      }).indexFiles({ root, files: [file] });
      const refs = (patch.facts.sourceRefs ?? []).filter(
        (sourceRef) => sourceRef.ref.metadata?.promptText,
      );

      expect(refs).toHaveLength(1);
      expect(refs[0]?.ref.snippet).toEqual({
        source: tag,
        language: "typescript",
        range: {
          file,
          startLine: 2,
          startColumn: 54,
          endLine: 2,
          endColumn: 54 + tag.length,
        },
        truncated: false,
      });
    },
    30_000,
  );
});

async function fixtureRoot(tag: string): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-exact-snippet-"),
  );
  roots.push(root);
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
    join(root, "src/index.ts"),
    `import { md, prompt } from '@use-crux/core'
export const writer = prompt({ id: 'writer', prompt: ${tag} })
`,
  );
  return root;
}
