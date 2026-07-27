import { describe, expect } from "vitest";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";
import type {
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from "../src/indexer/static-index/syntax";
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

describe("provider-visible tool boundary indexing", () => {
  itWithRustOxc(
    "normalizes every tool builder to the canonical model.input.tools target",
    async () => {
      const { fallbackOut, nativeOut, typescriptOut } =
        await extractNativeAndFallback({
          source: [
            "import { boundary, guardrail } from '@use-crux/core/safety'",
            "",
            "export const tools = guardrail({",
            "  id: 'tool-boundaries',",
            "  on: [",
            "    boundary.input.tools(),",
            "    boundary.input.tools({ from: 'discovered' }),",
            "    boundary.input.tools().descriptions(),",
            "    boundary.input.tools({ from: ['authored', 'discovered'] as const }).descriptions(),",
            "  ] as const,",
            "  run: () => ({ action: 'allow' as const }),",
            "})",
          ].join("\n"),
          callNames: ["guardrail"],
        });

      expectNativeExtractionParity(nativeOut, fallbackOut);
      expectNativeExtractionParity(nativeOut, typescriptOut);

      const definition = nativeOut.definitions.find(
        (candidate) => candidate.id === "guardrail:tool-boundaries",
      );
      expect(definition).toMatchObject({
        metadata: {
          boundary: "model.input.tools",
          boundaries: ["model.input.tools"],
          facts: {
            boundary: "model.input.tools",
            boundaries: ["model.input.tools"],
          },
        },
      });
      const serialized = JSON.stringify(definition?.metadata);
      expect(serialized).not.toContain("model.input.tools.descriptions");
      expect(serialized).not.toContain('"from"');
      expect(serialized).not.toContain('"selector"');
    },
    90_000,
  );

  itWithRustOxc(
    "keeps from and descriptions only as TypeScript/Rust syntax evidence",
    async () => {
      const source = [
        "import { boundary, guardrail } from '@use-crux/core/safety'",
        "export const descriptions = guardrail({",
        "  id: 'description-evidence',",
        "  on: boundary.input.tools({ from: 'discovered' }).descriptions(),",
        "  run: () => ({ action: 'allow' as const }),",
        "})",
      ].join("\n");
      const { record } = await extractNativeAndFallback({
        source,
        callNames: ["guardrail"],
      });
      const typescript = await createTypeScriptStaticSyntaxFrontend({
        callNames: ["guardrail"],
      }).parseFile({
        root: "/repo",
        file: "/repo/src/safety.ts",
        source,
      });
      const on = boundaryValue(record);

      expect(toolBoundaryEvidence(record)).toEqual(
        toolBoundaryEvidence(typescript),
      );
      expect(toolBoundaryEvidence(record)).toEqual({
        selector: "descriptions",
        helper: "tools",
        receiver: ["boundary", "input"],
        from: "discovered",
      });
      expect(on).toMatchObject({
        kind: "call",
        callee: expect.objectContaining({ name: "descriptions" }),
        receiver: expect.objectContaining({
          kind: "call",
          callee: expect.objectContaining({ name: "tools" }),
          args: [
            expect.objectContaining({
              kind: "object",
              properties: [
                expect.objectContaining({
                  name: "from",
                  value: { kind: "literal", value: "discovered" },
                }),
              ],
            }),
          ],
        }),
      });
    },
    90_000,
  );

  itWithRustOxc(
    "does not classify aliases or near-match helpers",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          "const tools = boundary.input.tools",
          "export const nearMatches = guardrail({",
          "  id: 'tool-near-matches',",
          "  on: [tools(), boundary.input.tool(), boundary.input.toolsExtra()] as const,",
          "  run: () => ({ action: 'allow' as const }),",
          "})",
        ].join("\n"),
        callNames: ["guardrail"],
      });
      const definition = nativeOut.definitions.find(
        (candidate) => candidate.id === "guardrail:tool-near-matches",
      );

      expect(definition?.metadata).not.toHaveProperty("boundary");
      expect(definition?.metadata).not.toHaveProperty("boundaries");
      expect(definition?.metadata?.facts).not.toHaveProperty("boundary");
    },
    90_000,
  );
});

function boundaryValue(
  record: StaticSyntaxFileRecord,
): StaticSyntaxValue | undefined {
  const match = record.matches[0];
  return match?.kind === "call"
    ? match.objectArg?.properties.find((property) => property.name === "on")
        ?.value
    : undefined;
}

function toolBoundaryEvidence(record: StaticSyntaxFileRecord): {
  readonly selector: string;
  readonly helper: string;
  readonly receiver: readonly string[];
  readonly from?: string;
} {
  const selected = boundaryValue(record);
  if (
    !selected ||
    selected.kind !== "call" ||
    selected.receiver?.kind !== "call"
  ) {
    throw new Error("Expected a chained tool-description boundary.");
  }
  const root = selected.receiver;
  return {
    selector: selected.callee.name,
    helper: root.callee.name,
    receiver:
      root.receiver?.kind === "property-access" ? root.receiver.path : [],
    ...literalFrom(root.args[0]),
  };
}

function literalFrom(value: StaticSyntaxValue | undefined): {
  readonly from?: string;
} {
  if (!value || value.kind !== "object") return {};
  const from = value.properties.find(
    (property) => property.name === "from",
  )?.value;
  return from?.kind === "literal" && typeof from.value === "string"
    ? { from: from.value }
    : {};
}
