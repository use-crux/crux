import { expect, it } from "vitest";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

it("retains a tagged template with a conservative unsupported tag callee", async () => {
  const file = "/repo/src/tagged.ts";
  const record = await createTypeScriptStaticSyntaxFrontend().parseFile({
    root: "/repo",
    file,
    source: [
      "const value = 'Ada'",
      "const computed = (choose ? md : html)`c${value}`",
    ].join("\n"),
  });
  const computed = record.localInitializers.find(
    (initializer) => initializer.name === "computed",
  );

  expect(computed?.value).toEqual({
    kind: "tagged-template",
    tag: { name: "<unknown>", direct: false },
    text: "`c${value}`",
    expressions: [
      {
        value: { kind: "identifier", name: "value" },
        source: { file, line: 2, column: 42 },
      },
    ],
    source: { file, line: 2, column: 18 },
    snippet: {
      source: "(choose ? md : html)`c${value}`",
      language: "typescript",
      range: {
        file,
        startLine: 2,
        startColumn: 18,
        endLine: 2,
        endColumn: 49,
      },
      truncated: false,
    },
  });
});
