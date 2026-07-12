import { describe, expect, it } from "vitest";
import { CRUX_PRIMITIVE_NAMES } from "../../src/observability/contract";
import {
  DEFINITION_KIND_COVERAGE,
  type CoverageDescriptor,
} from "../../src/project-index";
import { ProjectDefinitionKindSchema } from "../../src/project-index";

const VALID_PRIMITIVE_NAMES = new Set<string>(CRUX_PRIMITIVE_NAMES);

describe("DEFINITION_KIND_COVERAGE", () => {
  it("has exactly one entry per ProjectDefinitionKindSchema option, no more, no fewer", () => {
    const schemaKinds = [...ProjectDefinitionKindSchema.options].sort();
    const manifestKinds = Object.keys(DEFINITION_KIND_COVERAGE).sort();
    expect(manifestKinds).toEqual(schemaKinds);
  });

  it("only maps runtimePrimitiveNames to primitive names CRUX_PRIMITIVE_NAMES actually declares", () => {
    for (const [kind, descriptor] of Object.entries(DEFINITION_KIND_COVERAGE)) {
      for (const primitiveName of descriptor.runtimePrimitiveNames ?? []) {
        expect(
          VALID_PRIMITIVE_NAMES.has(primitiveName),
          `${kind} declares unknown primitive name "${primitiveName}"`,
        ).toBe(true);
      }
    }
  });

  it("requires at least one runtime primitive mapping for every declared direct-runtime secondary treatment", () => {
    for (const [kind, descriptor] of Object.entries(DEFINITION_KIND_COVERAGE)) {
      if (descriptor.secondary?.includes("direct-runtime")) {
        expect(
          (descriptor.runtimePrimitiveNames ?? []).length,
          `${kind} declares a direct-runtime secondary treatment with no runtimePrimitiveNames`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("classifies scorer as Quality-primary with direct-runtime scoring.judge as secondary evidence", () => {
    const scorer: CoverageDescriptor = DEFINITION_KIND_COVERAGE.scorer;
    expect(scorer.primary).toBe("quality-owned");
    expect(scorer.secondary).toContain("direct-runtime");
    expect(scorer.runtimePrimitiveNames).toContain("scoring.judge");
  });

  it("classifies unknown as the fallback sentinel with no runtime primitive mapping", () => {
    const unknown = DEFINITION_KIND_COVERAGE.unknown;
    expect(unknown.primary).toBe("fallback");
    expect(unknown.runtimePrimitiveNames ?? []).toHaveLength(0);
  });

  it("classifies every directly-observed category-A kind with at least one runtimePrimitiveNames entry", () => {
    const categoryA: Array<keyof typeof DEFINITION_KIND_COVERAGE> = [
      "prompt",
      "context",
      "tool",
      "agent",
      "flow",
      "task",
      "composition.parallel",
      "composition.pipeline",
      "composition.swarm",
      "composition.consensus",
      "routing.router",
      "routing.split",
      "routing.retry",
      "routing.cascade",
      "routing.fallback",
      "rag.recipe",
      "rag.reranker",
      "rag.retriever",
      "skill",
      "memory",
      "workspace",
      "constraint",
      "guardrail",
      "blackboard",
    ];
    expect(categoryA).toHaveLength(24);
    for (const kind of categoryA) {
      const descriptor = DEFINITION_KIND_COVERAGE[kind];
      expect(descriptor.primary, kind).toBe("directly-observed");
      expect((descriptor.runtimePrimitiveNames ?? []).length, kind).toBeGreaterThan(0);
    }
  });

  it("classifies runtime-contributor category-B kinds as never directly observed", () => {
    const categoryB: Array<keyof typeof DEFINITION_KIND_COVERAGE> = [
      "injectable",
      "rag.knowledgeBase",
      "storage.recordStore",
      "storage.vectorStore",
      "storage.blobStore",
      "toolPolicy",
    ];
    expect(categoryB).toHaveLength(6);
    for (const kind of categoryB) {
      expect(DEFINITION_KIND_COVERAGE[kind].primary, kind).toBe("runtime-contributor");
    }
    expect(DEFINITION_KIND_COVERAGE.injectable.runtimeIdentity).toBe("none");
    expect(DEFINITION_KIND_COVERAGE["rag.knowledgeBase"].runtimeIdentity).toBe("definition-ref");
    expect(DEFINITION_KIND_COVERAGE.toolPolicy.runtimeIdentity).toBe("definition-ref");
    expect(DEFINITION_KIND_COVERAGE["storage.recordStore"].runtimeIdentity).toBe("none");
    expect(DEFINITION_KIND_COVERAGE["storage.vectorStore"].runtimeIdentity).toBe("none");
    expect(DEFINITION_KIND_COVERAGE["storage.blobStore"].runtimeIdentity).toBe("none");
  });

  it("classifies dotted structural-child kinds whose parent is itself a ProjectDefinitionKind member", () => {
    const structuralChildren: Array<keyof typeof DEFINITION_KIND_COVERAGE> = [
      "flow.step",
      "composition.parallel.branch",
      "composition.pipeline.stage",
      "routing.router.route",
      "routing.split.route",
      "routing.retry.target",
      "routing.cascade.tier",
      "routing.fallback.option",
      "rag.recipe.step",
      "rag.pipeline.stage",
      "memory.store",
      "memory.block",
      "evaluation.case",
      "suite.case",
    ];
    expect(structuralChildren).toHaveLength(14);
    for (const kind of structuralChildren) {
      expect(DEFINITION_KIND_COVERAGE[kind].primary, kind).toBe("structural-child");
    }
  });

  it("marks evaluation.case and suite.case as also quality-owned via the secondary channel", () => {
    expect(DEFINITION_KIND_COVERAGE["evaluation.case"].secondary).toContain("quality-owned");
    expect(DEFINITION_KIND_COVERAGE["suite.case"].secondary).toContain("quality-owned");
  });

  it("distinguishes directly referenced children from parent-derived children", () => {
    expect(DEFINITION_KIND_COVERAGE["flow.step"].runtimeIdentity).toBe("definition-ref");
    expect(DEFINITION_KIND_COVERAGE["composition.parallel.branch"].runtimeIdentity).toBe("definition-ref");
    expect(DEFINITION_KIND_COVERAGE["rag.recipe.step"].runtimeIdentity).toBe("definition-ref");
    expect(DEFINITION_KIND_COVERAGE["composition.pipeline.stage"].runtimeIdentity).toBe("parent-derived");
    expect(DEFINITION_KIND_COVERAGE["routing.router.route"].runtimeIdentity).toBe("parent-derived");
    expect(DEFINITION_KIND_COVERAGE["rag.pipeline.stage"].runtimeIdentity).toBe("none");
    expect(DEFINITION_KIND_COVERAGE["evaluation.case"].runtimeIdentity).toBe("quality");
    expect(DEFINITION_KIND_COVERAGE["suite.case"].runtimeIdentity).toBe("quality");
  });

  it("keeps scorer Quality-primary while declaring canonical direct runtime identity", () => {
    expect(DEFINITION_KIND_COVERAGE.scorer.runtimeIdentity).toBe("definition-ref");
  });

  it("classifies genuinely static-only category-E kinds with no runtime primitive mapping", () => {
    const categoryE: Array<keyof typeof DEFINITION_KIND_COVERAGE> = [
      "registry",
      "storage.bundle",
      "storage.scope",
      "rag.pipeline",
    ];
    expect(categoryE).toHaveLength(4);
    for (const kind of categoryE) {
      const descriptor = DEFINITION_KIND_COVERAGE[kind];
      expect(descriptor.primary, kind).toBe("static-only");
      expect((descriptor.runtimePrimitiveNames ?? []).length, kind).toBe(0);
    }
  });

  it("regression: rag.pipeline is not directly-observed (no first-party emitter or compiled-definition builder exists)", () => {
    // Refuted category-A claim — see the manifest's `rag.pipeline` comment.
    // `rag.pipeline.stage` keeps its own mechanical structural-child
    // classification independently of this.
    expect(DEFINITION_KIND_COVERAGE["rag.pipeline"].primary).toBe("static-only");
    expect(DEFINITION_KIND_COVERAGE["rag.pipeline.stage"].primary).toBe("structural-child");
  });
});
