import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("semantic package cache validation", () => {
  it.each([
    [
      "typescript",
      "valid-to-wrong",
      "@use-crux/core",
      "@use-crux/lookalike",
      1,
      0,
    ],
    ["native", "valid-to-wrong", "@use-crux/core", "@use-crux/lookalike", 1, 0],
    [
      "typescript",
      "wrong-to-valid",
      "@use-crux/lookalike",
      "@use-crux/core",
      0,
      1,
    ],
    ["native", "wrong-to-valid", "@use-crux/lookalike", "@use-crux/core", 0, 1],
    ["typescript", "missing-to-valid", undefined, "@use-crux/core", 0, 1],
    ["native", "missing-to-valid", undefined, "@use-crux/core", 0, 1],
  ] as const)(
    "invalidates %s facts for a %s package-manifest transition",
    async (
      backendName,
      _transition,
      initialName,
      nextName,
      initialRefs,
      nextRefs,
    ) => {
      const root = await fixtureRoot(initialName);
      const file = join(root, "src/index.ts");
      const manifest = join(root, "node_modules/@use-crux/core/package.json");
      const timingNames: string[] = [];
      const service = createSemanticIndexService({
        backend:
          backendName === "typescript"
            ? createTypeScriptSemanticBackend()
            : createNativeSemanticBackend(),
      });

      const first = await service.indexFiles({
        root,
        files: [file],
        semanticInstrumentation: {
          onTiming: (timing) => timingNames.push(timing.name),
        },
      });
      expect(promptTextRefCount(first.facts.sourceRefs)).toBe(initialRefs);

      await writePackageManifest(manifest, nextName);
      const second = await service.indexFiles({
        root,
        files: [file],
        semanticInstrumentation: {
          onTiming: (timing) => timingNames.push(timing.name),
        },
      });

      expect(promptTextRefCount(second.facts.sourceRefs)).toBe(nextRefs);
      expect(
        timingNames.filter((name) => name === "semantic.cache.miss"),
      ).toHaveLength(2);
      expect(timingNames).not.toContain("semantic.cache.hit");
    },
    30_000,
  );
});

async function fixtureRoot(packageName: string | undefined): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-package-cache-"),
  );
  roots.push(root);
  const packageRoot = join(root, "node_modules/@use-crux/core");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "index.ts"),
    `export const md = (strings: TemplateStringsArray) => strings[0]
export const prompt = (config: unknown) => config
`,
  );
  if (packageName) {
    await writePackageManifest(join(packageRoot, "package.json"), packageName);
  }
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
export const writer = prompt({ id: 'writer', prompt: md\`Write\` })
`,
  );
  return root;
}

async function writePackageManifest(file: string, name: string): Promise<void> {
  await writeFile(
    file,
    JSON.stringify({
      name,
      version: "1.0.0",
      exports: { ".": "./index.ts" },
    }),
  );
}

function promptTextRefCount(
  refs:
    | readonly {
        readonly ref: { readonly metadata?: { readonly promptText?: unknown } };
      }[]
    | undefined,
): number {
  return (refs ?? []).filter((sourceRef) => sourceRef.ref.metadata?.promptText)
    .length;
}
