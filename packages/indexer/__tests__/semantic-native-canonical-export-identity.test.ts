import { unlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isTaggedTemplateExpression,
  type Node,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import { API, type Project } from "@typescript/native-preview/unstable/sync";
import { afterEach, describe, expect, it } from "vitest";
import { createTsgoNativeSourceLookup } from "../src/indexer/semantic/backends/tsgo/source-lookup";
import { createSemanticCacheValidationDependencyCollector } from "../src/indexer/semantic/cache-validation";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("native canonical package export identity", () => {
  it("proves exact Crux import/export aliases and rejects lookalikes", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/index.ts");

    await installCanonicalPackage(root);
    await writeFixture(root, "src/other.ts", ["export function md() {}"]);
    await writeFixture(root, "src/tags.ts", [
      "export { md as promptText } from '@use-crux/core'",
    ]);
    await writeFixture(root, "src/cycle-a.ts", [
      "export { cycleB as cycleA } from './cycle-b'",
    ]);
    await writeFixture(root, "src/cycle-b.ts", [
      "export { cycleA as cycleB } from './cycle-a'",
    ]);
    await writeFixture(root, "src/index.ts", [
      "import { md, md as text } from '@use-crux/core'",
      "import { prompt as wrongExport } from '@use-crux/core'",
      "import type { md as typeMd } from '@use-crux/core'",
      "import * as crux from '@use-crux/core'",
      "import type * as typeCrux from '@use-crux/core'",
      "import { promptText } from './tags'",
      "import { md as otherMd } from './other'",
      "import { missingMd } from './missing'",
      "import { cycleA } from './cycle-a'",
      "",
      "const localMd = () => undefined",
      "const valueAlias = md",
      "",
      "export const refs = [",
      "  md`direct`,",
      "  text`alias`,",
      "  wrongExport`wrong-export`,",
      "  crux.md`namespace`,",
      "  promptText`reexport`,",
      "  typeMd`type-only`,",
      "  typeCrux.md`type-only-namespace`,",
      "  localMd`local`,",
      "  valueAlias`value-alias`,",
      "  otherMd`unrelated`,",
      "  missingMd`unresolved`,",
      "  cycleA`cycle`,",
      "  ((md) => md`shadowed`)(localMd),",
      "]",
    ]);

    await withNativeProject(root, file, (project, sourceFile) => {
      const lookup = createTsgoNativeSourceLookup(project);
      const results = Object.fromEntries(
        collectNodes(sourceFile)
          .filter(isTaggedTemplateExpression)
          .map((tag) => [
            templateText(tag.getText(sourceFile)),
            lookup.isCanonicalExport(tag.tag, "@use-crux/core", "md"),
          ]),
      );

      expect(results).toEqual({
        direct: true,
        alias: true,
        "wrong-export": false,
        namespace: true,
        reexport: true,
        "type-only": false,
        "type-only-namespace": false,
        local: false,
        "value-alias": false,
        unrelated: false,
        unresolved: false,
        cycle: false,
        shadowed: false,
      });
    });
  }, 20_000);

  it.each([
    {
      name: "valid",
      manifest: JSON.stringify({
        name: "@use-crux/core",
        exports: { ".": "./index.ts" },
      }),
      canonical: true,
      dependencies: 1,
    },
    {
      name: "wrong-name",
      manifest: JSON.stringify({
        name: "@use-crux/lookalike",
        exports: { ".": "./index.ts" },
      }),
      canonical: false,
      dependencies: 1,
    },
    {
      name: "malformed",
      manifest: "{",
      canonical: false,
      dependencies: 1,
    },
    {
      name: "missing",
      manifest: undefined,
      canonical: false,
      dependencies: 0,
    },
  ])(
    "fails closed for $name compiler-selected package manifests",
    async ({ manifest, canonical, dependencies }) => {
      const root = await fixtureRoot();
      const packageRoot = join(root, "node_modules/@use-crux/core");
      const file = join(root, "src/index.ts");
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        join(packageRoot, "index.ts"),
        "export const md = (strings: TemplateStringsArray) => strings[0]\n",
      );
      const manifestFile = join(packageRoot, "package.json");
      await writeFile(
        manifestFile,
        manifest ??
          JSON.stringify({
            name: "@use-crux/core",
            version: "1.0.0",
            exports: { ".": "./index.ts" },
          }),
      );
      await writeFixture(root, "src/index.ts", [
        "import { md } from '@use-crux/core'",
        "export const value = md`manifest`",
      ]);

      await withNativeProject(root, file, (project, sourceFile) => {
        if (manifest === undefined) unlinkSync(manifestFile);
        const validationDependencies =
          createSemanticCacheValidationDependencyCollector();
        const lookup = createTsgoNativeSourceLookup(project, {
          validationDependencies,
        });
        const tag = collectNodes(sourceFile).find(isTaggedTemplateExpression);
        expect(tag).toBeDefined();
        expect(lookup.isCanonicalExport(tag!.tag, "@use-crux/core", "md")).toBe(
          canonical,
        );
        expect(validationDependencies.values()).toHaveLength(dependencies);
      });
    },
    20_000,
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-native-canonical-"),
  );
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
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
  return root;
}

async function installCanonicalPackage(root: string): Promise<void> {
  const packageRoot = join(root, "node_modules/@use-crux/core");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "index.ts"),
    [
      "export const md = (strings: TemplateStringsArray) => strings[0]",
      "export const prompt = (config: unknown) => config",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@use-crux/core",
      version: "1.0.0",
      exports: { ".": "./index.ts" },
    }),
  );
}

async function writeFixture(
  root: string,
  relativeFile: string,
  lines: readonly string[],
): Promise<void> {
  await writeFile(join(root, relativeFile), `${lines.join("\n")}\n`);
}

async function withNativeProject(
  root: string,
  file: string,
  run: (project: Project, sourceFile: SourceFile) => void,
): Promise<void> {
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({
    openProject: join(root, "tsconfig.json"),
  });
  try {
    const project =
      snapshot.getDefaultProjectForFile(file) ?? snapshot.getProjects()[0];
    expect(project).toBeDefined();
    const sourceFile = project!.program.getSourceFile(file);
    expect(sourceFile).toBeDefined();
    run(project!, sourceFile!);
  } finally {
    snapshot.dispose();
    api.close();
  }
}

function collectNodes(sourceFile: SourceFile): readonly Node[] {
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return nodes;
}

function templateText(source: string): string {
  return source.slice(source.indexOf("`") + 1, -1);
}
