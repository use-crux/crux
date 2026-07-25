import { expect, it } from "vitest";
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();
const parityTest = rustOxcStatus.available ? it : it.skip;

parityTest(
  rustOxcStatus.available
    ? "keeps long tagged-template snippets exact across frontends"
    : `keeps long tagged-template snippets exact across frontends [skipped: ${rustOxcStatus.reason}]`,
  async () => {
    const file = "/repo/src/tagged.ts";
    const body = "x".repeat(12_001);
    const source = [
      "import { md } from '@use-crux/core'",
      `const long = md\`${body}\``,
    ].join("\n");
    const input = { root: "/repo", file, source };
    const [typescript, oxc] = await Promise.all([
      createTypeScriptStaticSyntaxFrontend().parseFile(input),
      createRustOxcStaticSyntaxFrontend().parseFile(input),
    ]);
    const typescriptValue = initializerValue(typescript, "long");
    const oxcValue = initializerValue(oxc, "long");

    expect(typescriptValue.kind).toBe("tagged-template");
    if (typescriptValue.kind !== "tagged-template")
      throw new Error("Expected TypeScript tagged-template record");
    expect(typescriptValue.snippet).toMatchObject({
      source: `md\`${body}\``,
      language: "typescript",
      range: {
        file,
        startLine: 2,
        startColumn: 14,
        endLine: 2,
        endColumn: 12_019,
      },
      truncated: false,
    });
    expect(typescriptValue).toEqual(oxcValue);
  },
);

function initializerValue(record: StaticSyntaxFileRecord, name: string) {
  const initializer = record.localInitializers.find(
    (candidate) => candidate.name === name,
  );
  if (!initializer) throw new Error(`Missing ${name} initializer`);
  return initializer.value;
}
