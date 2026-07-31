import { describe, expect, it } from "vitest";
import {
  DEFINITION_KIND_COVERAGE,
  type DirectlyObservedKind,
} from "../../src/project-index/definition-kind-coverage";
import {
  DIRECTLY_OBSERVED_DEFINITION_REF_ROLES,
  definitionRef,
  effectDefinitionRef,
} from "../../src/observability/definition-ref";
import { DefinitionRefRoleSchema } from "../../src/observability/schema";

/**
 * The machine-readable guard: every directly-observed kind in the coverage
 * manifest must have a closed role/builder mapping, and vice versa. This is the
 * runtime counterpart to the compile-time `Record<DirectlyObservedKind, …>`
 * total-map check, so a manifest drift fails a test even in JS-only consumers.
 */
const directlyObservedKinds = Object.entries(DEFINITION_KIND_COVERAGE)
  .filter(([, descriptor]) => descriptor.primary === "directly-observed")
  .map(([kind]) => kind as DirectlyObservedKind);

describe("directly-observed kinds ↔ DefinitionRef role/builder mapping", () => {
  it("joins memory.capture through the canonical invoked-memory role", () => {
    expect(DEFINITION_KIND_COVERAGE.memory.runtimePrimitiveNames).toContain(
      "memory.capture",
    );
    expect(definitionRef("memory", "conversation")).toEqual({
      id: "memory:conversation",
      kind: "memory",
      role: "invoked-memory",
    });
  });

  it("joins Effect identity after normalizing only its authored id", () => {
    expect(effectDefinitionRef("payments charge !", 2)).toEqual({
      id: "effect:payments-charge:v2",
      kind: "effect",
      role: "invoked-effect",
    });
    expect(effectDefinitionRef("large", 1e21).id).toBe("effect:large:v1e+21");
    expect(effectDefinitionRef("small", 1e-7).id).toBe("effect:small:v1e-7");
    expect(effectDefinitionRef("fractional", 1.5).id).toBe(
      "effect:fractional:v1.5",
    );
  });

  it("covers every directly-observed manifest kind with exactly one role", () => {
    const mapped = Object.keys(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES).sort();
    expect(mapped).toEqual([...directlyObservedKinds].sort());
  });

  it("maps no kind that is not directly-observed", () => {
    for (const kind of Object.keys(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES)) {
      expect(
        DEFINITION_KIND_COVERAGE[kind as DirectlyObservedKind].primary,
      ).toBe("directly-observed");
    }
  });

  it("uses only schema-valid roles", () => {
    for (const role of Object.values(DIRECTLY_OBSERVED_DEFINITION_REF_ROLES)) {
      expect(DefinitionRefRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("builds a canonical <kind>:<safeId(id)> ref for every directly-observed kind", () => {
    for (const kind of directlyObservedKinds.filter(
      (candidate) => candidate !== "effect",
    ) as Exclude<DirectlyObservedKind, "effect">[]) {
      const ref = definitionRef(kind, "sample-id");
      expect(ref).toEqual({
        id: `${kind}:sample-id`,
        kind,
        role: DIRECTLY_OBSERVED_DEFINITION_REF_ROLES[kind],
      });
    }
  });
});
