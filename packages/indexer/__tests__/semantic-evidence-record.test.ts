import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic evidence.record discovery", () => {
  it("resolves aliases and re-exports without retaining authored private values", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/reexport.ts"),
      `export { evidence as proof } from '@use-crux/core'\n`,
    );
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { proof } from './reexport'`,
        `const input = {`,
        `  role: 'authority', kind: 'custom.approval', conclusion: 'allowed',`,
        `  ref: { kind: 'artifact', id: 'PRIVATE_REF_SENTINEL' },`,
        `  idempotencyKey: 'PRIVATE_KEY_SENTINEL',`,
        `}`,
        `proof.record(input)`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexFiles({
      root,
      files: [join(root, "src/index.ts"), join(root, "src/reexport.ts")],
    });

    expect(patch.status).toBe("ok");
    const definition = patch.facts.definitions?.find(
      (item) => item.kind === "evidence.record",
    );
    expect(definition?.metadata?.facts).toMatchObject({
      kind: "evidence.record",
      role: "authority",
      evidenceKind: {
        classification: "custom",
        value: "custom.approval",
      },
      conclusion: "allowed",
      sourceForm: "reference",
      subjectMode: "ambient",
      idempotent: true,
      supersedes: false,
    });
    expect(JSON.stringify(patch.facts)).not.toMatch(
      /PRIVATE_REF_SENTINEL|PRIVATE_KEY_SENTINEL/,
    );
  });

  it("emits location-only config refs and the nearest compiler-proven owner", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, "src/index.ts"),
      [
        `import { evidence, prompt } from '@use-crux/core'`,
        `export const reviewer = prompt({`,
        `  id: 'reviewer',`,
        `  render: () => evidence.record({`,
        `    role: 'verification',`,
        `    kind: 'custom.review',`,
        `    data: { secret: 'SOURCE_REF_PRIVATE_SENTINEL' },`,
        `  }),`,
        `})`,
      ].join("\n"),
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexFiles({
      root,
      files: [join(root, "src/index.ts")],
    });

    expect(patch.status).toBe("ok");
    const definition = patch.facts.definitions?.find(
      (item) => item.kind === "evidence.record",
    );
    expect(definition).toBeDefined();
    expect(
      patch.facts.relations?.some(
        (relation) =>
          relation.type === "evidence.record.declared_in" &&
          relation.from === definition?.id &&
          relation.to === "prompt:reviewer",
      ),
    ).toBe(true);
    expect(
      patch.facts.sourceRefs
        ?.filter((entry) => entry.definitionId === definition?.id)
        .map((entry) => ({
          property: entry.ref.property,
          role: entry.ref.role,
          hasLocation: Boolean(
            entry.ref.source.file &&
              entry.ref.source.line &&
              entry.ref.source.column,
          ),
        })),
    ).toEqual([
      { property: "data", role: "config", hasLocation: true },
      { property: "kind", role: "config", hasLocation: true },
      { property: "role", role: "config", hasLocation: true },
    ]);
    expect(JSON.stringify(patch.facts)).not.toMatch(
      /SOURCE_REF_PRIVATE_SENTINEL/,
    );
  });
});

async function fixtureRoot(): Promise<string> {
  const parent = join(process.cwd(), ".tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "semantic-evidence-record-"));
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
  return root;
}
