import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createSourceFile } from "../src/indexer/ast/parse";
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import { staticCalleeRecordFromExpression } from "../src/indexer/static-index/syntax/record/typescript-callee";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";

const file = "/repo/src/shadowed.ts";
const source = [
  "import { md } from '@use-crux/core'",
  "import * as crux from '@use-crux/core'",
  "const identifier = (md) => md`local identifier`",
  "const namespace = (crux) => crux.md`local namespace`",
  "const localIdentifier = () => { const md = html; return md`block identifier` }",
  "const localNamespace = () => { const crux = local; return crux.md`block namespace` }",
  "const hoisted = () => { if (flag) { var md = html } return md`hoisted local` }",
].join("\n");
const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();

describe("static tagged-template lexical identity", () => {
  it("does not attach import evidence to shadowed identifier or namespace tags", async () => {
    const record = await createTypeScriptStaticSyntaxFrontend().parseFile({
      root: "/repo",
      file,
      source,
    });

    expect(returnedTag(record, "identifier")).toEqual({
      name: "md",
      direct: true,
      localName: "md",
    });
    expect(returnedTag(record, "namespace")).toEqual({
      name: "md",
      direct: false,
      localName: "md",
      receiverName: "crux",
    });
    expect(returnedTag(record, "localIdentifier")).toEqual({
      name: "md",
      direct: true,
      localName: "md",
    });
    expect(returnedTag(record, "localNamespace")).toEqual({
      name: "md",
      direct: false,
      localName: "md",
      receiverName: "crux",
    });
    expect(returnedTag(record, "hoisted")).toEqual({
      name: "md",
      direct: true,
      localName: "md",
    });
  });

  it("uses binding identity for method names and loop declarations", () => {
    expect(
      tagCallee([
        "import { md } from '@use-crux/core'",
        "class Example { md() { return md`imported` } }",
      ]),
    ).toEqual(importedMd());
    expect(
      tagCallee([
        "import { md } from '@use-crux/core'",
        "for (const md of tags) { md`loop local` }",
      ]),
    ).toEqual({
      name: "md",
      direct: true,
      localName: "md",
    });
  });

  const parityTest = rustOxcStatus.available ? it : it.skip;
  parityTest(
    rustOxcStatus.available
      ? "keeps Oxc and TypeScript shadowed tag records equal"
      : `keeps Oxc and TypeScript shadowed tag records equal [skipped: ${rustOxcStatus.reason}]`,
    async () => {
      const input = { root: "/repo", file, source };
      const [typescript, oxc] = await Promise.all([
        createTypeScriptStaticSyntaxFrontend().parseFile(input),
        createRustOxcStaticSyntaxFrontend().parseFile(input),
      ]);

      for (const name of [
        "identifier",
        "namespace",
        "localIdentifier",
        "localNamespace",
        "hoisted",
      ]) {
        expect(returnedTag(oxc, name)).toEqual(returnedTag(typescript, name));
      }

      for (const extension of ["js", "jsx", "mts", "cts"]) {
        const scriptFile = `/repo/src/shadowed.${extension}`;
        const scriptSource = [
          "import { md } from '@use-crux/core'",
          "const direct = md`imported`",
          "const shadowed = (md) => md`local`",
        ].join("\n");
        const scriptInput = {
          root: "/repo",
          file: scriptFile,
          source: scriptSource,
        };
        const [typescriptScript, oxcScript] = await Promise.all([
          createTypeScriptStaticSyntaxFrontend().parseFile(scriptInput),
          createRustOxcStaticSyntaxFrontend().parseFile(scriptInput),
        ]);

        expect(initializerValue(typescriptScript, "direct")).toEqual(
          initializerValue(oxcScript, "direct"),
        );
        expect(returnedValue(typescriptScript, "shadowed")).toEqual(
          returnedValue(oxcScript, "shadowed"),
        );
      }
    },
  );
});

function returnedTag(record: StaticSyntaxFileRecord, name: string) {
  return returnedValue(record, name).tag;
}

function returnedValue(record: StaticSyntaxFileRecord, name: string) {
  const initializer = record.localInitializers.find(
    (candidate) => candidate.name === name,
  );
  if (!initializer || initializer.value.kind !== "function")
    throw new Error(`Missing ${name} function initializer`);
  const returned = initializer.value.returns[0];
  if (!returned || returned.kind !== "tagged-template")
    throw new Error(`Missing ${name} tagged return`);
  return returned;
}

function initializerTag(record: StaticSyntaxFileRecord, name: string) {
  return initializerValue(record, name).tag;
}

function initializerValue(record: StaticSyntaxFileRecord, name: string) {
  const initializer = record.localInitializers.find(
    (candidate) => candidate.name === name,
  );
  if (!initializer || initializer.value.kind !== "tagged-template")
    throw new Error(`Missing ${name} tagged initializer`);
  return initializer.value;
}

function tagCallee(lines: readonly string[]) {
  const sourceFile = createSourceFile(file, lines.join("\n"));
  let found: ts.TaggedTemplateExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isTaggedTemplateExpression(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error("Missing tagged template");
  return staticCalleeRecordFromExpression(
    found.tag,
    new Map([
      [
        "md",
        {
          localName: "md",
          importedName: "md",
          moduleSpecifier: "@use-crux/core",
          importKind: "value" as const,
          source: { file, line: 1, column: 1 },
        },
      ],
    ]),
  );
}

function importedMd() {
  return {
    name: "md",
    direct: true,
    localName: "md",
    importedName: "md",
    moduleSpecifier: "@use-crux/core",
  };
}
