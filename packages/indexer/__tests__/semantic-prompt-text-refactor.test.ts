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

describe("ordinary string PromptText refactor evidence", () => {
  it("is strict and backend-identical for canonical value bindings", async () => {
    const root = await fixtureRoot();
    const files = [
      "direct.ts",
      "renamed.ts",
      "namespace.ts",
      "reexport.ts",
      "missing.ts",
      "multiple.ts",
      "type-only.ts",
      "computed.ts",
      "wrapped.ts",
      "shadowed.ts",
      "value-alias.ts",
      "indirect.ts",
      "unrelated.ts",
      "spread.ts",
      "spread-before.ts",
      "spread-after.ts",
      "method.ts",
      "callback.ts",
      "concatenated.ts",
      "substitution.ts",
    ].map((file) => join(root, "src", file));

    const typescript = await index(root, files, "typescript");
    const native = await index(root, files, "native");
    expect(native).toEqual(typescript);
    expect(
      native.map(({ definitionId, ref }) => ({
        definitionId,
        role: ref.role,
        property: ref.property,
        snippet: ref.snippet?.source,
        metadata: ref.metadata,
      })),
    ).toEqual([
      {
        definitionId: "prompt:direct",
        role: "prompt",
        property: "prompt",
        snippet: '"first\\nsecond"',
        metadata: {
          promptTextRefactor: {
            kind: "ordinary-string-to-md",
            proof: "semantic-exact",
            lifecycle: "static",
            target: "md",
            binding: { kind: "identifier", expression: "md" },
          },
        },
      },
      {
        definitionId: "prompt:namespace",
        role: "system",
        property: "system",
        snippet: "`first\nsecond`",
        metadata: {
          promptTextRefactor: {
            kind: "ordinary-string-to-md",
            proof: "semantic-exact",
            lifecycle: "static",
            target: "md",
            binding: {
              kind: "namespace-access",
              expression: "core.md",
            },
          },
        },
      },
      {
        definitionId: "prompt:reexport",
        role: "prompt",
        property: "prompt",
        snippet: '"first\\nsecond"',
        metadata: {
          promptTextRefactor: {
            kind: "ordinary-string-to-md",
            proof: "semantic-exact",
            lifecycle: "static",
            target: "md",
            binding: { kind: "identifier", expression: "text" },
          },
        },
      },
      {
        definitionId: "prompt:renamed",
        role: "prompt",
        property: "prompt",
        snippet: '"first\\nsecond"',
        metadata: {
          promptTextRefactor: {
            kind: "ordinary-string-to-md",
            proof: "semantic-exact",
            lifecycle: "static",
            target: "md",
            binding: { kind: "identifier", expression: "text" },
          },
        },
      },
    ]);
  }, 30_000);
});

async function index(
  root: string,
  files: readonly string[],
  backend: "typescript" | "native",
) {
  const patch = await createSemanticIndexService({
    backend:
      backend === "typescript"
        ? createTypeScriptSemanticBackend({ cache: "disabled" })
        : createNativeSemanticBackend({ cache: "disabled" }),
  }).indexFiles({ root, files });
  expect(patch.status, JSON.stringify(patch.facts.diagnostics)).toBe("ok");
  return (patch.facts.sourceRefs ?? [])
    .filter(({ ref }) => ref.metadata?.promptTextRefactor)
    .sort((left, right) => left.definitionId.localeCompare(right.definitionId));
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-prompt-refactor-"));
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
  const fixtures: Record<string, string> = {
    "direct.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "direct", prompt: "first\\nsecond" })`,
    "renamed.ts": `import { md as text, prompt } from "@use-crux/core"
export const value = prompt({ id: "renamed", prompt: "first\\nsecond" })`,
    "namespace.ts": `import * as core from "@use-crux/core"
import { prompt } from "@use-crux/core"
export const value = prompt({ id: "namespace", system: \`first
second\` })`,
    "tags.ts": `export { md as text } from "@use-crux/core"`,
    "reexport.ts": `import { prompt } from "@use-crux/core"
import { text } from "./tags"
export const value = prompt({ id: "reexport", prompt: "first\\nsecond" })`,
    "missing.ts": `import { prompt } from "@use-crux/core"
export const value = prompt({ id: "missing", prompt: "first\\nsecond" })`,
    "multiple.ts": `import { md as first, md as second, prompt } from "@use-crux/core"
export const value = prompt({ id: "multiple", prompt: "first\\nsecond" })`,
    "type-only.ts": `import type { md } from "@use-crux/core"
import { prompt } from "@use-crux/core"
export const value = prompt({ id: "type-only", prompt: "first\\nsecond" })`,
    "computed.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "computed", ["prompt"]: "first\\nsecond" })`,
    "wrapped.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "wrapped", prompt: ("first\\nsecond" as string) })`,
    "shadowed.ts": `import { md, prompt } from "@use-crux/core"
export function make(md: unknown) {
  return prompt({ id: "shadowed", prompt: "first\\nsecond" })
}`,
    "value-alias.ts": `import { md as imported, prompt } from "@use-crux/core"
const text = imported
export function make(imported: unknown) {
  return prompt({ id: "value-alias", prompt: "first\\nsecond" })
}`,
    "indirect.ts": `import { md, prompt } from "@use-crux/core"
const text = "first\\nsecond"
export const value = prompt({ id: "indirect", prompt: text })`,
    "unrelated.ts": `import { md } from "@use-crux/core"
export const value = { id: "unrelated", prompt: "first\\nsecond" }`,
    "spread.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "spread", ...{ prompt: "first\\nsecond" } })`,
    "spread-before.ts": `import { md, prompt } from "@use-crux/core"
const defaults = {}
export const value = prompt({ ...defaults, id: "spread-before", prompt: "first\\nsecond" })`,
    "spread-after.ts": `import { md, prompt } from "@use-crux/core"
const override = {}
export const value = prompt({ id: "spread-after", prompt: "first\\nsecond", ...override })`,
    "method.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "method", prompt() { return "first\\nsecond" } })`,
    "callback.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "callback", prompt: () => "first\\nsecond" })`,
    "concatenated.ts": `import { md, prompt } from "@use-crux/core"
export const value = prompt({ id: "concatenated", prompt: "first" + "\\nsecond" })`,
    "substitution.ts": `import { md, prompt } from "@use-crux/core"
const name = "second"
export const value = prompt({ id: "substitution", prompt: \`first
\${name}\` })`,
  };
  await Promise.all(
    Object.entries(fixtures).map(([file, source]) =>
      writeFile(join(root, "src", file), source),
    ),
  );
  return root;
}
