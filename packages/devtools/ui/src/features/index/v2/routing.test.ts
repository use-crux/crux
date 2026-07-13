import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectDefinition, ProjectIndexData } from "@/types";
import { glyphFor } from "@/features/index/components/IndexKind";
import { buildIndex } from "./adapt";
import { kindMeta } from "./kit";
import { RoutingCatalogFacts } from "./routing-catalog";

describe("routing index metadata", () => {
  it("labels stable split and retry kinds in legacy and v2 index views", () => {
    expect(glyphFor("routing.split")).toMatchObject({ label: "split" });
    expect(glyphFor("routing.retry.target")).toMatchObject({
      label: "retry target",
    });
    expect(kindMeta("routing.split")).toMatchObject({
      label: "Split",
      family: "routing",
      child: false,
    });
    expect(kindMeta("routing.retry.target")).toMatchObject({
      label: "Retry target",
      family: "routing",
      child: true,
    });
  });

  it("adapts and renders routing context, profiles, and every routing relation", () => {
    const index = buildIndex(routingIndexData());
    const router = requiredDefinition(index, "routing.router:tenant-router");
    const split = requiredDefinition(index, "routing.split:tenant-split");
    const routerRoute = requiredDefinition(
      index,
      "routing.router:tenant-router:route:pro",
    );
    const splitRoute = requiredDefinition(
      index,
      "routing.split:tenant-split:route:stable",
    );

    expect(router.facts).toMatchObject({
      routingContextType: '{ tenantId: string; tier: "free" | "pro"; }',
      routingContextRequired: true,
    });
    expect(split.facts).toMatchObject({ routingContextRequired: true });
    expect(routerRoute.config).toEqual({
      profile: { temperature: 0.2, maxTokens: 1200 },
    });
    expect(splitRoute.config).toEqual({
      profile: { weight: 100, temperature: 0.1 },
    });

    for (const [childId, targetId] of Object.entries(routingTargets)) {
      expect(index.relationsOf(childId).outgoing.map((relation) => relation.to)).toContain(
        targetId,
      );
    }

    const markup = renderToStaticMarkup(
      createElement(
        "div",
        undefined,
        ...Object.values(routingDefinitionIds).map((id) =>
          createElement(RoutingCatalogFacts, {
            key: id,
            facts: requiredDefinition(index, id).facts,
          }),
        ),
      ),
    );
    expect(markup).toContain("routing.router");
    expect(markup).toContain("routing.split");
    expect(markup).toContain("routing.retry");
    expect(markup).toContain("routing.cascade");
    expect(markup).toContain("routing.fallback");
    expect(markup).toContain("tenantId");
    expect(markup).toContain("required");
    expect(markup).toContain("temperature");
    expect(markup).toContain("maxTokens");
  });
});

const routingDefinitionIds = {
  router: "routing.router:tenant-router",
  routerRoute: "routing.router:tenant-router:route:pro",
  split: "routing.split:tenant-split",
  splitRoute: "routing.split:tenant-split:route:stable",
  retry: "routing.retry:retry-writer",
  retryTarget: "routing.retry:retry-writer:target:1",
  cascade: "routing.cascade:quality-cascade",
  cascadeTier: "routing.cascade:quality-cascade:tier:1",
  fallback: "routing.fallback:resilient-writer",
  fallbackOption: "routing.fallback:resilient-writer:option:1",
} as const;

const routingTargets: Readonly<Record<string, string>> = {
  [routingDefinitionIds.routerRoute]: "prompt:pro-writer",
  [routingDefinitionIds.splitRoute]: "prompt:stable-writer",
  [routingDefinitionIds.retryTarget]: "prompt:retry-writer",
  [routingDefinitionIds.cascadeTier]: "prompt:cascade-writer",
  [routingDefinitionIds.fallbackOption]: "prompt:fallback-writer",
};

function routingIndexData(): ProjectIndexData {
  const parent = (
    id: string,
    kind:
      | "routing.router"
      | "routing.split"
      | "routing.retry"
      | "routing.cascade"
      | "routing.fallback",
    facts: NonNullable<ProjectDefinition["metadata"]>["facts"],
  ): ProjectDefinition => ({
    id,
    kind,
    name: id.split(":")[1] ?? id,
    fidelity: "resolved",
    status: "active",
    metadata: { facts },
  });
  const child = (
    id: string,
    kind:
      | "routing.router.route"
      | "routing.split.route"
      | "routing.retry.target"
      | "routing.cascade.tier"
      | "routing.fallback.option",
    parentDefinitionId: string,
    facts: NonNullable<ProjectDefinition["metadata"]>["facts"],
  ): ProjectDefinition => ({
    id,
    kind,
    name: id.split(":").at(-1) ?? id,
    fidelity: "resolved",
    status: "active",
    metadata: {
      facts,
      profile: profileFromFacts(facts),
      indexPresentation: {
        standalone: false,
        parentDefinitionId,
        parentRelationType: "routing.includes_route",
        role: "route",
      },
    },
  });
  const definitions = [
    parent(routingDefinitionIds.router, "routing.router", {
      kind: "routing.router",
      routingContextType: '{ tenantId: string; tier: "free" | "pro"; }',
      routingContextRequired: true,
    }),
    child(
      routingDefinitionIds.routerRoute,
      "routing.router.route",
      routingDefinitionIds.router,
      {
        kind: "routing.router.route",
        targetDefinitionId: routingTargets[routingDefinitionIds.routerRoute],
        profile: { temperature: 0.2, maxTokens: 1200 },
      },
    ),
    parent(routingDefinitionIds.split, "routing.split", {
      kind: "routing.split",
      routingContextType: '{ tenantId: string; tier: "free" | "pro"; }',
      routingContextRequired: true,
    }),
    child(
      routingDefinitionIds.splitRoute,
      "routing.split.route",
      routingDefinitionIds.split,
      {
        kind: "routing.split.route",
        targetDefinitionId: routingTargets[routingDefinitionIds.splitRoute],
        profile: { weight: 100, temperature: 0.1 },
      },
    ),
    parent(routingDefinitionIds.retry, "routing.retry", { kind: "routing.retry", attempts: 2 }),
    child(routingDefinitionIds.retryTarget, "routing.retry.target", routingDefinitionIds.retry, {
      kind: "routing.retry.target",
      targetDefinitionId: routingTargets[routingDefinitionIds.retryTarget],
    }),
    parent(routingDefinitionIds.cascade, "routing.cascade", { kind: "routing.cascade", tierCount: 1 }),
    child(routingDefinitionIds.cascadeTier, "routing.cascade.tier", routingDefinitionIds.cascade, {
      kind: "routing.cascade.tier",
      targetDefinitionId: routingTargets[routingDefinitionIds.cascadeTier],
    }),
    parent(routingDefinitionIds.fallback, "routing.fallback", { kind: "routing.fallback", optionCount: 1 }),
    child(routingDefinitionIds.fallbackOption, "routing.fallback.option", routingDefinitionIds.fallback, {
      kind: "routing.fallback.option",
      targetDefinitionId: routingTargets[routingDefinitionIds.fallbackOption],
    }),
  ];
  return {
    prompts: [],
    contexts: [],
    tools: [],
    definitions,
    relations: Object.entries(routingTargets).map(([from, to]) => ({
      id: `${from}:target`,
      type: "routing.uses_target",
      from,
      to,
      fidelity: "resolved",
    })),
    diagnostics: [],
    lintFindings: [],
    sources: [],
  };
}

function requiredDefinition(
  index: ReturnType<typeof buildIndex>,
  id: string,
) {
  const definition = index.byId(id);
  if (!definition) throw new Error(`Missing routing definition ${id}`);
  return definition;
}

function profileFromFacts(
  facts: NonNullable<ProjectDefinition["metadata"]>["facts"],
): Record<string, unknown> | undefined {
  const profile = facts && "profile" in facts ? facts.profile : undefined;
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile as Record<string, unknown>
    : undefined;
}
