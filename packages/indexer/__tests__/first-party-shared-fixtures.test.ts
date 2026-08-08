import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../src/contracts/fixtures";
import { builtInIndexRuleDescriptors } from "../src/indexer/lints/rules";
import { indexRelationPolicies } from "../src/indexer/relations";
import { finalizeStaticIndexFactsWithWorker } from "../src/testing/static-index-worker";
import {
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

const effectFixtureUrl = new URL(
  "../fixtures/effect-static-project/effects.ts",
  import.meta.url,
);

describe("first-party shared static index fixtures", () => {
  itWithRustOxc(
    "projects the shared effect-definition source through both static frontends",
    async () => {
      const source = await readFile(effectFixtureUrl, "utf8");
      const result = await extractNativeAndFallback({
        source,
        callNames: ["effect", "rollbackOnError"],
      });

      expect(nativeFactCount(result.record, "effect")).toBe(5);
      for (const [frontend, output] of [
        ["native", result.nativeOut],
        ["typescript", result.typescriptOut],
      ] as const) {
        const effects = output.definitions.filter(
          (definition) => definition.kind === "effect",
        );
        expect(effects).toHaveLength(5);
        expect(effects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "inventory.reserve",
              metadata: expect.objectContaining({
                exportName: "reserveInventory",
                exported: true,
              }),
            }),
            expect.objectContaining({
              name: "payments.charge",
              metadata: expect.objectContaining({
                facts: {
                  kind: "effect",
                  effectId: "payments.charge",
                  version: 2,
                  recoverable: true,
                  capture: false,
                  resource: true,
                },
              }),
            }),
            expect.objectContaining({
              name: "crm.customer.replace",
              metadata: expect.objectContaining({
                facts: expect.objectContaining({
                  recoverable: true,
                  capture: true,
                }),
              }),
            }),
            expect.objectContaining({
              name: "dynamicEffect",
              fidelity: "partial",
              metadata: expect.objectContaining({
                facts: expect.not.objectContaining({
                  effectId: expect.anything(),
                }),
              }),
            }),
          ]),
        );
        const duplicates = effects.filter(
          (definition) => definition.id === "effect:payments.charge:v2",
        );
        expect(duplicates, `${frontend} duplicate definitions`).toHaveLength(2);
        expect(
          duplicates.flatMap((definition) =>
            (definition.sourceRefs ?? [])
              .filter((ref) => ref.role === "execute")
              .map((ref) => ref.id),
          ),
          `${frontend} duplicate definition evidence`,
        ).toEqual([
          "effect:payments.charge:v2:source:execute:executor:execute:src-fixture.ts:be4c7cffd8136a5a:2",
          "effect:payments.charge:v2:source:execute:executor:execute:src-fixture.ts:be4c7cffd8136a5a:5",
        ]);
        const requiredBoundaryRefs = effects.flatMap((definition) =>
          (definition.sourceRefs ?? []).filter(
            (ref) =>
              ref.role === "config" &&
              ref.property === "rollbackOnError.recovery",
          ),
        );
        expect
          .soft(requiredBoundaryRefs, `${frontend} required-boundary evidence`)
          .toEqual([
            expect.objectContaining({
              symbol: "rollbackOnError",
              source: expect.objectContaining({
                file: expect.stringMatching(/src\/fixture\.ts$/),
              }),
              fidelity: "resolved",
            }),
          ]);
      }
    },
    30_000,
  );

  itWithRustOxc(
    "retains mixed exported Effect duplicates through both static frontends",
    async () => {
      const result = await extractNativeAndFallback({
        source: `
          import { effect } from "@use-crux/core/effect";
          const execute = async () => undefined;
          export const exportedEffect = effect("mixed", execute, { version: 1.5 });
          const discoveredEffect = effect("mixed", execute, { version: 1.5 });
        `,
        callNames: ["effect"],
      });

      for (const output of [result.nativeOut, result.typescriptOut]) {
        const effects = output.definitions.filter(
          (definition) => definition.id === "effect:mixed:v1.5",
        );
        expect(effects).toHaveLength(2);
        expect(
          new Set(
            effects.flatMap((definition) =>
              (definition.sourceRefs ?? []).map((ref) => ref.id),
            ),
          ).size,
        ).toBe(2);
      }
    },
    30_000,
  );

  itWithRustOxc(
    "finalizes the irreversible required-boundary finding identically from both frontends",
    async () => {
      const source = await readFile(effectFixtureUrl, "utf8");
      const result = await extractNativeAndFallback({
        source,
        primaryPath: "src/effects.ts",
        callNames: ["effect", "rollbackOnError"],
      });
      const finalize = (output: typeof result.nativeOut) =>
        finalizeStaticIndexFactsWithWorker({
          root: "/workspace/acme",
          nativeFacts: [{ definitions: output.definitions }],
        });
      const nativeFacts = await finalize(result.nativeOut);
      const typescriptFacts = await finalize(result.typescriptOut);
      const findings = (facts: typeof nativeFacts) =>
        (facts.lintFindings ?? []).filter(
          (finding) =>
            finding.ruleId ===
            "effect.irreversible_in_required_boundary",
        );

      expect(findings(typescriptFacts)).toEqual(findings(nativeFacts));
      expect(findings(typescriptFacts)).toEqual([
        expect.objectContaining({
          source: expect.objectContaining({
            file: expect.stringMatching(/src\/effects\.ts$/),
            line: 33,
          }),
          message: expect.stringMatching(
            /inventory\.reserve.*src\/effects\.ts:33.*Define recovery.*move the Effect outside.*best-effort/,
          ),
        }),
      ]);
    },
    30_000,
  );

  itWithRustOxc(
    "requires certain irreversible targets and certain required boundary options",
    async () => {
      const result = await extractNativeAndFallback({
        source: `
          import { effect, rollbackOnError } from "@use-crux/core/effect";
          const execute = async () => undefined;
          const recover = async () => undefined;
          const irreversible = effect("irreversible", execute);
          const recoverable = effect("recoverable", execute, { recover });
          const dynamicOptions = {};
          const unknownRecovery = effect("unknown-recovery", execute, dynamicOptions);
          declare const dynamicId: string;
          const unanalyzableId = effect(dynamicId, execute);
          const irreversibleAlias = irreversible;
          const effectBag = { irreversible };
          declare const chooseEffect: boolean;
          const dynamicReference = chooseEffect ? irreversible : recoverable;
          const requiredOptions = { recovery: "required" } as const;
          const recoveryMode = "required" as const;

          void rollbackOnError(async () => { await irreversible(); });
          void rollbackOnError(async () => { await irreversible(); }, {});
          void rollbackOnError(async () => { await irreversible(); }, { recovery: "required" });
          void rollbackOnError(async () => { await irreversibleAlias(); });
          void rollbackOnError(async () => { await effectBag.irreversible(); });
          void rollbackOnError(async () => { await irreversible(); }, { recovery: "best-effort" });
          void rollbackOnError(async () => { await irreversible(); }, { ...requiredOptions });
          void rollbackOnError(async () => { await irreversible(); }, requiredOptions);
          void rollbackOnError(async () => { await irreversible(); }, { recovery: recoveryMode });
          void rollbackOnError(async () => { await dynamicReference(); });
          void rollbackOnError(async () => { await unanalyzableId(); });
          void rollbackOnError(async () => { await recoverable(); });
          void rollbackOnError(async () => { await unknownRecovery(); });
        `,
        callNames: ["effect", "rollbackOnError"],
      });

      const boundaryRefs = (output: typeof result.nativeOut) =>
        output.definitions.flatMap((definition) =>
          (definition.sourceRefs ?? []).filter(
            (ref) => ref.property === "rollbackOnError.recovery",
          ),
        );
      expect(boundaryRefs(result.nativeOut)).toEqual(
        boundaryRefs(result.typescriptOut),
      );
      expect(boundaryRefs(result.nativeOut)).toHaveLength(5);
      expect(
        boundaryRefs(result.nativeOut).map((ref) => ref.description),
      ).toEqual([
        'Required-recovery boundary contains irreversible Effect "irreversible"',
        'Required-recovery boundary contains irreversible Effect "irreversible"',
        'Required-recovery boundary contains irreversible Effect "irreversible"',
        'Required-recovery boundary contains irreversible Effect "irreversible"',
        'Required-recovery boundary contains irreversible Effect "irreversible"',
      ]);
    },
    30_000,
  );

  itWithRustOxc(
    "canonicalizes Effect versions and effective object options identically",
    async () => {
      const result = await extractNativeAndFallback({
        source: `
          import { effect } from "@use-crux/core/effect";
          const execute = async () => undefined;
          const options = {};
          const recover = async () => undefined;
          const large = effect("large", execute, { version: 1e21 });
          const small = effect("small", execute, { version: 1e-7 });
          const fractional = effect("fractional", execute, { version: 1.5 });
          const duplicateFractional = effect("fractional", execute, { version: 1.5 });
          const lastWrite = effect("last-write", execute, { version: 1, version: 2 });
          const spreadBefore = effect("spread-before", execute, { ...options, version: 2, resource: execute });
          const spreadAfter = effect("spread-after", execute, { version: 2, resource: execute, ...options });
          const identifierRecovery = effect("identifier-recovery", execute, { recover });
          const incompleteCapture = effect("incomplete-capture", execute, { recover: { capture: execute } });
          const completeCapture = effect("complete-capture", execute, { recover: { capture: execute, execute } });
        `,
        callNames: ["effect"],
      });

      const summarize = (output: typeof result.nativeOut) =>
        output.definitions
          .filter((definition) => definition.kind === "effect")
          .map((definition) => ({
            id: definition.id,
            fidelity: definition.fidelity,
            facts: definition.metadata?.facts,
          }));
      expect(summarize(result.nativeOut)).toEqual(
        summarize(result.typescriptOut),
      );
      expect(summarize(result.nativeOut)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "effect:large:v1e+21" }),
          expect.objectContaining({ id: "effect:small:v1e-7" }),
          expect.objectContaining({ id: "effect:fractional:v1.5" }),
          expect.objectContaining({ id: "effect:last-write:v2" }),
          expect.objectContaining({
            id: "effect:spread-before:v2",
            facts: expect.objectContaining({ resource: true }),
          }),
          expect.objectContaining({
            fidelity: "partial",
            facts: expect.objectContaining({ resource: "unknown" }),
          }),
          expect.objectContaining({
            id: "effect:identifier-recovery:v1",
            facts: expect.objectContaining({
              recoverable: true,
              capture: "unknown",
            }),
          }),
          expect.objectContaining({
            id: "effect:incomplete-capture:v1",
            facts: expect.objectContaining({ capture: false }),
          }),
          expect.objectContaining({
            id: "effect:complete-capture:v1",
            facts: expect.objectContaining({ capture: true }),
          }),
        ]),
      );
    },
    30_000,
  );

  itWithRustOxc(
    "does not infer irreversible boundaries through cross-file Effect imports",
    async () => {
      const result = await extractNativeAndFallback({
        source: `
          import { rollbackOnError } from "@use-crux/core/effect";
          import { importedEffect } from "./effects";
          void rollbackOnError(async () => { await importedEffect(); });
        `,
        additionalFiles: [
          {
            path: "src/effects.ts",
            source: `
              import { effect } from "@use-crux/core/effect";
              export const importedEffect = effect("imported", async () => undefined);
            `,
          },
        ],
        callNames: ["effect", "rollbackOnError"],
      });

      for (const output of [result.nativeOut, result.typescriptOut]) {
        expect(
          output.definitions.flatMap((definition) =>
            (definition.sourceRefs ?? []).filter(
              (ref) => ref.property === "rollbackOnError.recovery",
            ),
          ),
        ).toEqual([]);
      }
    },
    30_000,
  );

  itWithRustOxc(
    "keeps Effect source-ref identities distinct for colliding safe paths",
    async () => {
      const source = `
        import { effect } from "@use-crux/core/effect";
        const execute = async () => undefined;
        export const item = effect("collision", execute);
      `;
      const [nested, dashed] = await Promise.all(
        ["src/a/b.ts", "src/a-b.ts"].map((primaryPath) =>
          extractNativeAndFallback({
            source,
            primaryPath,
            callNames: ["effect"],
          }),
        ),
      );
      for (const result of [nested, dashed]) {
        expect(result.nativeOut.definitions[0]?.sourceRefs).toEqual(
          result.typescriptOut.definitions[0]?.sourceRefs,
        );
      }
      expect(nested.nativeOut.definitions[0]?.sourceRefs?.[0]?.id).not.toBe(
        dashed.nativeOut.definitions[0]?.sourceRefs?.[0]?.id,
      );
    },
    30_000,
  );

  itWithRustOxc(
    "does not turn an Effect re-export into another definition",
    async () => {
      const effects = await readFile(effectFixtureUrl, "utf8");
      const result = await extractNativeAndFallback({
        source: 'export { chargePayment } from "./effects";',
        primaryPath: "src/reexport.ts",
        additionalFiles: [{ path: "src/effects.ts", source: effects }],
        callNames: ["effect"],
      });

      expect(nativeFactCount(result.record, "effect")).toBe(0);
      expect(result.nativeOut.definitions).toEqual([]);
      expect(result.typescriptOut.definitions).toEqual([]);
    },
    30_000,
  );

  it("validates shared static syntax, relation, and rule fixture files", () => {
    const syntax = readStaticIndexRuntimeSharedFixture("static-syntax-records");
    expect(syntax.records).toHaveLength(1);
    expect(syntax.records[0]).toMatchObject({
      schemaVersion: 1,
      frontend: { name: "oxc-rust" },
      file: "/repo/src/contract.ts",
      matches: [
        expect.objectContaining({
          kind: "call",
          variableName: "contractPrompt",
        }),
      ],
      nativeFacts: [
        expect.objectContaining({
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
        }),
      ],
    });

    const relationSpecs = readStaticIndexRuntimeSharedFixture("relation-specs");
    const relationPoliciesByType = new Map(
      indexRelationPolicies.map((policy) => [policy.type, policy]),
    );
    for (const policy of relationSpecs.policies) {
      expect(relationPoliciesByType.get(policy.type)).toMatchObject(policy);
    }

    const ruleDescriptors =
      readStaticIndexRuntimeSharedFixture("rule-descriptors");
    const builtInDescriptors = builtInIndexRuleDescriptors();

    expect(
      ruleDescriptors.descriptors.map((descriptor) => descriptor.id),
    ).toEqual(builtInDescriptors.map((descriptor) => descriptor.id));
    expect(ruleDescriptors.descriptors).toEqual(builtInDescriptors);
  });

  it("audits native coverage identities against required parity fixture classes", () => {
    const coverage = readStaticIndexRuntimeSharedFixture(
      "primitive-coverage-identities",
    );
    const coveredExtractors = coverage.identities
      .map((identity) => identity.extractor)
      .sort();

    expect(coverage.requiredFixtureClasses).toEqual([
      "definitions",
      "relations",
      "sourceRefs",
      "diagnostics",
      "dependencies",
      "lints",
      "sources",
      "sourceGraph",
      "runtimeMetadata",
      "degradedBehavior",
    ]);
    expect(
      coverage.identities.map((identity) => identity.extractor).sort(),
    ).toEqual(coveredExtractors);
    for (const identity of coverage.identities) {
      const media =
        identity.extractor === "media.operation" ||
        identity.extractor === "ingest.source";
      const mcp = identity.extractor === "mcp.server";
      const signal =
        identity.extractor === "signal" ||
        identity.extractor === "signal.provider" ||
        identity.extractor === "signal.transport" ||
        identity.extractor === "signal.transport.polling" ||
        identity.extractor === "signal.transport.stream" ||
        identity.extractor === "signal.transport.sse" ||
        identity.extractor === "signal.transport.websocket" ||
        identity.extractor === "signal.transportBinding";
      expect(identity.extension).toBe(
        media
          ? "@use-crux/indexer/crux-core-media"
          : mcp
            ? "@use-crux/indexer/crux-core-mcp"
            : "@use-crux/indexer/crux-core",
      );
      expect(identity.family).toBe(identity.extractor);
      expect(identity.nativeCovered).toBe(true);
      expect(
        identity.parityFixtures.positive,
        `${identity.extractor} positive parity fixture`,
      ).toBe(identity.fixtureClasses.definitions);
      expect(
        identity.parityFixtures.negative,
        `${identity.extractor} negative parity fixture`,
      ).toBe(
        media
          ? "media-native-static.test.ts"
          : mcp
            ? "mcp-native-static.test.ts"
            : signal
              ? "signal-native-static.test.ts"
              : identity.extractor === "evidence.record"
                ? "evidence-record-native-static.test.ts"
                : identity.extractor === "thread"
                  ? "thread-native-static.test.ts"
                  : identity.extractor === "session"
                    ? "session-native-static.test.ts"
                    : "first-party-native-negative-fixtures.test.ts",
      );
      for (const fixtureClass of coverage.requiredFixtureClasses) {
        expect(
          identity.fixtureClasses[fixtureClass],
          `${identity.extractor} missing ${fixtureClass}`,
        ).toMatch(/\.(ts|json)$/);
      }
      expect(
        Object.values(identity.fixtureClasses),
        `${identity.extractor} generic static protocol anchor`,
      ).not.toContain("static-index-protocol.json");
    }
  });
});
