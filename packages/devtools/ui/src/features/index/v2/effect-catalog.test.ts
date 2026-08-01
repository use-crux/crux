import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex, indexFactChips } from "./adapt";
import { IndexBrowser } from "./browser";
import { IndexIndexProvider } from "./context";
import { indexSectionOrder } from "./detail";
import {
  effectCatalogRailLabel,
  projectEffectCatalog,
} from "./effect-catalog";
import { IndexHero } from "./hero";
import { kindMeta } from "./kit";

const fixture = {
  project: { root: "/repo" },
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "effect:payments.charge:v2",
      kind: "effect",
      name: "payments.charge",
      fidelity: "resolved",
      source: { file: "/repo/src/effects.ts", line: 7, column: 30 },
      sourceRefs: [
        {
          id: "effect:payments.charge:v2:source:execute",
          role: "execute",
          property: "executor",
          symbol: "execute",
          source: { file: "/repo/src/effects.ts", line: 7, column: 30 },
          fidelity: "resolved",
        },
      ],
      metadata: {
        facts: {
          kind: "effect",
          effectId: "payments.charge",
          version: 2,
          recoverable: true,
          capture: false,
          resource: true,
        },
      },
    },
    {
      id: "effect:effects.ts:dynamicEffect:4",
      kind: "effect",
      name: "dynamicEffect",
      fidelity: "partial",
      metadata: {
        facts: {
          kind: "effect",
          version: 1,
          recoverable: false,
          capture: false,
          resource: false,
        },
      },
    },
    {
      id: "effect:effects.ts:dynamicVersion:5",
      kind: "effect",
      name: "dynamic.version",
      fidelity: "partial",
      metadata: {
        facts: {
          kind: "effect",
          effectId: "dynamic.version",
          recoverable: "unknown",
          capture: "unknown",
          resource: "unknown",
        },
      },
    },
  ],
  relations: [],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

function renderHero(definitionId: string): string {
  const index = buildIndex(fixture);
  return renderToStaticMarkup(
    createElement(IndexIndexProvider, {
      index,
      children: createElement(IndexHero, {
        def: index.byId(definitionId)!,
      }),
    }),
  );
}

describe("Effect Catalog projection", () => {
  it("projects identity, recovery facts, and the execute source ref", () => {
    const view = projectEffectCatalog({
      id: "effect:payments.charge:v2",
      kind: "effect",
      name: "payments.charge",
      facts: {
        kind: "effect",
        effectId: "payments.charge",
        version: 2,
        recoverable: true,
        capture: false,
        resource: true,
      },
      sourceRefs: [
        {
          id: "effect:payments.charge:v2:source:execute",
          role: "execute",
          property: "executor",
          symbol: "execute",
          source: {
            file: "/repo/src/effects.ts",
            line: 7,
            column: 30,
            function: "execute",
          },
          fidelity: "resolved",
        },
      ],
      relPath: (file) => file?.replace("/repo/", ""),
    });

    expect(view).toEqual({
      kind: "effect",
      id: "effect:payments.charge:v2",
      name: "payments.charge",
      effectId: "payments.charge",
      version: 2,
      recoverable: true,
      capture: false,
      resource: true,
      sources: [
        {
          refId: "effect:payments.charge:v2:source:execute",
          file: "src/effects.ts",
          line: 7,
          column: 30,
        },
      ],
    });
  });

  it("preserves every execute source ref for a duplicate identity", () => {
    const view = projectEffectCatalog({
      id: "effect:payments.charge:v2",
      kind: "effect",
      name: "payments.charge",
      facts: {
        kind: "effect",
        effectId: "payments.charge",
        version: 2,
        recoverable: true,
        capture: false,
        resource: true,
      },
      sourceRefs: [7, 24].map((line) => ({
        id: `effect:payments.charge:v2:source:execute:${line}`,
        role: "execute" as const,
        source: { file: "/repo/src/effects.ts", line },
        fidelity: "resolved" as const,
      })),
      relPath: (file) => file?.replace("/repo/", ""),
    });

    expect(view?.sources).toEqual([
      {
        refId: "effect:payments.charge:v2:source:execute:7",
        file: "src/effects.ts",
        line: 7,
      },
      {
        refId: "effect:payments.charge:v2:source:execute:24",
        file: "src/effects.ts",
        line: 24,
      },
    ]);
  });

  it("keeps an unanalyzable Effect id distinct from its binding name", () => {
    const view = projectEffectCatalog({
      id: "effect:effects.ts:dynamicEffect:4",
      kind: "effect",
      name: "dynamicEffect",
      facts: {
        kind: "effect",
        version: 1,
        recoverable: false,
        capture: false,
        resource: false,
      },
      relPath: (file) => file,
    });

    expect(view).toMatchObject({
      name: "dynamicEffect",
      version: 1,
      recoverable: false,
      capture: false,
      resource: false,
    });
    expect(view).not.toHaveProperty("effectId");
  });

  it("renders the standard Catalog hero grammar for an Effect", () => {
    const html = renderHero("effect:payments.charge:v2");

    expect(html).toContain("Effect identity");
    expect(html).toContain("payments.charge");
    expect(html).toContain("v2");
    expect(html).toContain("Recoverable");
    expect(html).toContain("No capture");
    expect(html).toContain("Resource projection");
    expect(html).toContain("src/effects.ts:7");
  });

  it("renders unresolved version and option states explicitly", () => {
    const html = renderHero("effect:effects.ts:dynamicVersion:5");

    expect(html).toContain("Version unknown");
    expect(html).toContain("Recovery unknown");
    expect(html).toContain("Capture unknown");
    expect(html).toContain("Resource unknown");
  });

  it("renders an unanalyzable id without presenting the binding as identity", () => {
    const html = renderHero("effect:effects.ts:dynamicEffect:4");

    expect(html).toContain("Binding");
    expect(html).toContain("dynamicEffect");
    expect(html).toContain("Effect id is not statically analyzable.");
    expect(html).toContain("Irreversible");
  });

  it("wires Effects into the state family and standard detail sections", () => {
    const index = buildIndex(fixture);
    const definition = index.byId("effect:payments.charge:v2")!;

    expect(kindMeta("effect")).toMatchObject({
      label: "Effect",
      family: "state",
      tone: "plum",
    });
    expect(indexFactChips(definition)).toEqual([
      ["id", "payments.charge"],
      ["version", 2],
      ["recovery", "recoverable"],
      ["capture", "no"],
    ]);
    expect(indexSectionOrder(definition)).toEqual([
      "hero",
      "source",
      "observability",
      "relations",
      "health",
    ]);
  });

  it("renders Effect identity, version, and recoverability in Catalog rows", () => {
    const index = buildIndex(fixture);
    const html = renderToStaticMarkup(
      createElement(IndexIndexProvider, {
        index,
        children: createElement(IndexBrowser, {
          selected: null,
          onSelect: () => undefined,
          graphOpen: false,
          onGraphClose: () => undefined,
          onOpenEval: () => undefined,
        }),
      }),
    );

    expect(html).toContain("payments.charge");
    expect(html).toContain("v2 · recoverable");
    expect(html).toContain("dynamicEffect");
    expect(html).toContain("dynamic id · v1 · irreversible");
    expect(
      effectCatalogRailLabel(
        index.byId("effect:effects.ts:dynamicVersion:5")!.effectCatalog!,
      ),
    ).toBe("version unknown · recovery unknown");
  });
});
