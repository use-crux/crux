import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completionSiteManifest } from "../src/indexer/semantic/backends/tsgo/direct-projectors/completion-sites";
import {
  nativeDirectPrimitiveManifest,
  objectDependencyTargetKinds,
  type NativeDirectIdentifierDependencySpec,
} from "../src/indexer/semantic/backends/tsgo/direct-projectors/manifest";

describe("completion site manifest", () => {
  it("normalizes every admitted authored-reference role without a second semantic table", () => {
    const shared = JSON.parse(
      readFileSync(
        new URL(
          "../../../crates/primitives/src/completion_sites.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(completionSiteManifest(nativeDirectPrimitiveManifest)).toEqual(
      shared,
    );
    expect(shared).toEqual([
      {
        callNames: ["router"],
        propertyPath: ["routes", "*"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["router"],
        propertyPath: ["routes", "*", "model"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["split"],
        propertyPath: ["routes", "*", "model"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["retry"],
        propertyPath: ["$args", "0"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["cascade"],
        propertyPath: ["tiers", "*", "model"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["fallback"],
        propertyPath: ["$args", "0", "*"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["fallback"],
        propertyPath: ["$args", "*"],
        slot: "routingTarget",
        acceptedKinds: routingTargetKinds,
        insertion: "identifier",
        excludeSelf: true,
      },
      {
        callNames: ["session", "getSession"],
        propertyPath: ["$args", "0"],
        slot: "scalarIdentifier",
        acceptedKinds: ["agent", "flow"],
        insertion: "identifier",
      },
      {
        callNames: ["agent"],
        propertyPath: ["prompt"],
        slot: "scalarIdentifier",
        acceptedKinds: ["prompt"],
        insertion: "identifier",
      },
      {
        callNames: ["agent"],
        propertyPath: ["model"],
        slot: "scalarIdentifier",
        acceptedKinds: routingOwnerKinds,
        insertion: "identifier",
      },
      {
        callNames: ["agent"],
        propertyPath: ["languageModel"],
        slot: "scalarIdentifier",
        acceptedKinds: routingOwnerKinds,
        insertion: "identifier",
      },
      {
        callNames: ["agent"],
        propertyPath: ["tools", "*"],
        slot: "toolMapMember",
        acceptedKinds: ["tool", "agent"],
        insertion: "toolMapMember",
      },
      {
        callNames: ["agent"],
        propertyPath: ["handoffs", "*"],
        slot: "staticId",
        acceptedKinds: ["agent"],
        insertion: "staticId",
        excludeSelf: true,
      },
      {
        callNames: ["agent"],
        propertyPath: ["handoffs", "*", "id"],
        slot: "staticId",
        acceptedKinds: ["agent"],
        insertion: "staticId",
        excludeSelf: true,
      },
      {
        callNames: ["context"],
        propertyPath: ["use", "*"],
        slot: "identifierArrayElement",
        acceptedKinds: ["context", "thread", "mcp.server"],
        insertion: "identifier",
      },
      {
        callNames: ["context"],
        propertyPath: ["tools", "*"],
        slot: "toolMapMember",
        acceptedKinds: ["tool"],
        insertion: "toolMapMember",
      },
      {
        callNames: ["prompt"],
        propertyPath: ["use", "*"],
        slot: "identifierArrayElement",
        acceptedKinds: ["context", "thread", "mcp.server"],
        insertion: "identifier",
      },
      {
        callNames: ["prompt"],
        propertyPath: ["tools", "*"],
        slot: "toolMapMember",
        acceptedKinds: ["tool"],
        insertion: "toolMapMember",
      },
    ]);
  });

  it("admits every emitted declarative dependency role except documented exclusions", () => {
    const admitted = completionSiteManifest(nativeDirectPrimitiveManifest)
      .filter((site) => !specializedCallNames.has(site.callNames[0] ?? ""))
      .flatMap((site) =>
        site.acceptedKinds.map((kind) =>
          roleKey(site.callNames[0] ?? "", site.propertyPath, kind),
        ),
      )
      .sort();

    const emitted = nativeDirectPrimitiveManifest
      .flatMap((primitive) =>
        primitive.dependencies.flatMap((dependency) => {
          switch (dependency.kind) {
            case "identifierProperty":
              return identifierKinds(dependency).map((kind) =>
                roleKey(primitive.callName, [dependency.property], kind),
              );
            case "arrayIdentifier":
              return [
                roleKey(
                  primitive.callName,
                  [dependency.property, "*"],
                  dependency.targetKind,
                ),
              ];
            case "objectShorthand":
              return objectDependencyTargetKinds(dependency).map((kind) =>
                roleKey(
                  primitive.callName,
                  [dependency.property, "*"],
                  kind,
                ),
              );
            case "staticIdArray":
              return [
                roleKey(
                  primitive.callName,
                  [dependency.property, "*"],
                  dependency.targetKind,
                ),
                roleKey(
                  primitive.callName,
                  [dependency.property, "*", "id"],
                  dependency.targetKind,
                ),
              ];
            case "mcpExpectedTools":
              return [];
          }
        }),
      )
      .sort();

    expect(admitted).toEqual(emitted);
  });
});

const routingOwnerKinds = [
  "routing.router",
  "routing.split",
  "routing.retry",
  "routing.cascade",
  "routing.fallback",
] as const;

const routingTargetKinds = [...routingOwnerKinds, "agent", "prompt"] as const;

const specializedCallNames = new Set([
  "router",
  "split",
  "retry",
  "cascade",
  "fallback",
  "session",
  "getSession",
]);

function roleKey(
  callName: string,
  propertyPath: readonly string[],
  kind: string,
): string {
  return `${callName}:${propertyPath.join(".")}→${kind}`;
}

function identifierKinds(
  dependency: NativeDirectIdentifierDependencySpec,
): readonly string[] {
  return dependency.targetKinds ?? [dependency.targetKind];
}
