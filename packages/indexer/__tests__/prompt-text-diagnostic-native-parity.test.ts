import { API } from "@typescript/native-preview/unstable/sync";
import { afterEach, describe, expect, it } from "vitest";
import { createTypeScriptSemanticFactInput } from "../src/indexer/semantic/backends/typescript/fact-input";
import { createTsgoCompilerView } from "../src/indexer/semantic/backends/tsgo/compiler-view";
import { nativePromptTextDiagnosticConclusions } from "../src/indexer/semantic/backends/tsgo/prompt-text-diagnostics";
import { createTsgoNativeSourceLookup } from "../src/indexer/semantic/backends/tsgo/source-lookup";
import { createSemanticCacheValidationDependencyCollector } from "../src/indexer/semantic/cache-validation";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText normalized diagnostic parity", () => {
  it("matches JavaScript and native conclusions before projection", async () => {
    const { root, file, facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `import * as core from "@use-crux/core"`,
        `import { text } from "./tags"`,
        `const exactTrue = true`,
        `const values = ["first", "second"] as string[]`,
        `const nullableValues = ["first", null] as string[]`,
        `const dynamicContent = () => md\`Value: \${true}\``,
        `declare const unknownValue: unknown`,
        `type Recursive = readonly [Recursive?]`,
        `declare const recursive: Recursive`,
        `declare const invalidUnion: true | 1n | symbol | (() => void) | { value: string }`,
        `export const invalid = prompt({ id: "invalid", prompt: md\`Value: \${exactTrue}\` })`,
        `export const sequence = prompt({ id: "sequence", prompt: md\`Values: \${values}\` })`,
        `export const nullableSequence = prompt({ id: "nullable-sequence", prompt: md\`Values: \${nullableValues}\` })`,
        `export const json = prompt({ id: "json", prompt: md\`Value: \${core.md.json(undefined)}\` })`,
        `export const reexported = prompt({ id: "reexported", prompt: text\`Value: \${text.json(undefined)}\` })`,
        `export const object = prompt({ id: "object", prompt: md\`Value: \${Promise.resolve("value")}\` })`,
        `export const system = prompt({ id: "system", system: md\`Value: \${true}\` })`,
        `export const dynamic = prompt({ id: "dynamic", prompt: dynamicContent })`,
        `export const uncertain = prompt({ id: "uncertain", prompt: md\`Value: \${unknownValue}\` })`,
        `export const recursiveSequence = prompt({ id: "recursive", prompt: md\`Values: \${recursive}\` })`,
        `export const finite = prompt({ id: "finite", prompt: md\`Value: \${42}\` })`,
        `export const nonfinite = prompt({ id: "nonfinite", prompt: md\`Value: \${NaN}\` })`,
        `export const union = prompt({ id: "union", prompt: md\`Value: \${invalidUnion}\` })`,
        `export const nested = prompt({ id: "nested", prompt: md\`Value: \${([["safe", true] as const] as const)}\` })`,
      ].join("\n"),
      {
        "src/tags.ts": `export { md as text } from "@use-crux/core"`,
      },
    );
    const sourceRefs = facts.sourceRefs ?? [];
    const typescriptInput = createTypeScriptSemanticFactInput(root, [file]);
    const typescript =
      typescriptInput.promptTextDiagnosticConclusions?.(sourceRefs) ?? [];

    const api = new API({ cwd: root });
    const snapshot = api.updateSnapshot({
      openProject: `${root}/tsconfig.json`,
    });
    try {
      const project =
        snapshot.getDefaultProjectForFile(file) ?? snapshot.getProjects()[0];
      if (!project) throw new Error("Expected native semantic project.");
      const sourceFile = project.program.getSourceFile(file);
      if (!sourceFile) throw new Error("Expected native fixture source.");
      const sourceLookup = createTsgoNativeSourceLookup(project, {
        validationDependencies:
          createSemanticCacheValidationDependencyCollector(),
      });
      const view = createTsgoCompilerView(
        { name: "native-parity", version: "v1" },
        project,
        sourceLookup,
      );
      const native = nativePromptTextDiagnosticConclusions({
        checker: project.checker,
        sourceFiles: [sourceFile],
        sourceRefs,
        view,
      });

      expect(JSON.stringify(native)).toBe(JSON.stringify(typescript));
      expect(
        native.map(({ definitionId, owner, cause }) => ({
          definitionId,
          owner,
          cause,
        })),
      ).toEqual(
        expect.arrayContaining([
          {
            definitionId: "prompt:reexported",
            owner: {
              role: "prompt",
              property: "prompt",
              lifecycle: "static",
            },
            cause: {
              kind: "json-serialization",
              reason: "undefined-result",
            },
          },
          {
            definitionId: "prompt:system",
            owner: {
              role: "system",
              property: "system",
              lifecycle: "static",
            },
            cause: expect.objectContaining({
              kind: "invalid-interpolation",
            }),
          },
          {
            definitionId: "prompt:dynamic",
            owner: {
              role: "prompt",
              property: "prompt",
              lifecycle: "dynamic",
            },
            cause: expect.objectContaining({
              kind: "invalid-interpolation",
            }),
          },
          {
            definitionId: "prompt:recursive",
            owner: {
              role: "prompt",
              property: "prompt",
              lifecycle: "static",
            },
            cause: {
              kind: "inline-sequence",
            },
          },
          {
            definitionId: "prompt:nonfinite",
            owner: {
              role: "prompt",
              property: "prompt",
              lifecycle: "static",
            },
            cause: {
              kind: "invalid-interpolation",
              runtimeKinds: ["non-finite-number"],
              mdJsonApplicable: true,
            },
          },
          {
            definitionId: "prompt:union",
            owner: {
              role: "prompt",
              property: "prompt",
              lifecycle: "static",
            },
            cause: {
              kind: "invalid-interpolation",
              runtimeKinds: [
                "boolean",
                "bigint",
                "symbol",
                "function",
                "object",
              ],
            },
          },
        ]),
      );
      expect(
        native.filter(({ definitionId }) =>
          ["prompt:uncertain", "prompt:finite"].includes(definitionId),
        ),
      ).toEqual([]);
      expect(
        native.find(({ definitionId }) => definitionId === "prompt:nested")
          ?.interpolation.path,
      ).toEqual([0, 1]);
    } finally {
      snapshot.dispose();
      api.close();
    }
  });
});
