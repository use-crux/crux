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

describe("semantic compiler paths cache validation", () => {
  it.each(["typescript", "native"] as const)(
    "rechecks intercepted package roots across one %s service session",
    async (backendName) => {
      const root = await fixtureRoot();
      const file = join(root, "src/index.ts");
      const tsconfig = join(root, "tsconfig.json");
      const timingNames: string[] = [];
      const service = createSemanticIndexService({
        backend:
          backendName === "typescript"
            ? createTypeScriptSemanticBackend()
            : createNativeSemanticBackend(),
      });
      const index = () =>
        service.indexFiles({
          root,
          files: [file],
          semanticInstrumentation: {
            onTiming: (timing) => timingNames.push(timing.name),
          },
        });

      expect(promptTextRefCount((await index()).facts.sourceRefs)).toBe(1);

      await writeTsconfig(tsconfig, true);
      expect(promptTextRefCount((await index()).facts.sourceRefs)).toBe(0);

      await writeTsconfig(tsconfig, false);
      expect(promptTextRefCount((await index()).facts.sourceRefs)).toBe(1);
      expect(
        timingNames.filter((name) => name === "semantic.cache.miss"),
      ).toHaveLength(2);
      expect(
        timingNames.filter((name) => name === "semantic.cache.hit"),
      ).toHaveLength(1);
    },
    30_000,
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-semantic-paths-cache-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
  await symlink(
    join(process.cwd(), "../core"),
    join(root, "node_modules/@use-crux/core"),
    "dir",
  );
  await writeTsconfig(join(root, "tsconfig.json"), false);
  await writeFile(
    join(root, "src/index.ts"),
    `import { md, prompt } from '@use-crux/core'
export const writer = prompt({ id: 'writer', prompt: md\`Write\` })
`,
  );
  return root;
}

async function writeTsconfig(file: string, interceptCore: boolean) {
  await writeFile(
    file,
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
        ...(interceptCore
          ? {
              baseUrl: ".",
              paths: {
                "@use-crux/core": ["node_modules/@use-crux/core/src/index.ts"],
              },
            }
          : {}),
      },
      include: ["src/**/*.ts"],
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
