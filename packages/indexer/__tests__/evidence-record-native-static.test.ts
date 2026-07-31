import { describe, expect } from "vitest";
import {
  expectNativeExtractionParity,
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

describe("evidence.record native static projection", () => {
  itWithRustOxc(
    "projects canonical member calls and retains only privacy-safe facts",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["record"],
        source: [
          `import { evidence as proof } from '@use-crux/core'`,
          `const privatePayload = { secret: 'PROJECT_INDEX_PRIVATE_SENTINEL' }`,
          `const options = {`,
          `  role: 'verification',`,
          `  kind: 'custom.review',`,
          `  conclusion: 'passed',`,
          `  data: privatePayload,`,
          `  subject: { kind: 'run', id: 'private-run' },`,
          `  idempotencyKey: 'private-key',`,
          `  supersedes: ['private-evidence-id'],`,
          `}`,
          `proof.record(options)`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "evidence.record")).toBe(1);
      expect(
        result.nativeOut.definitions.find(
          (definition) => definition.kind === "evidence.record",
        ),
      ).toMatchObject({
        kind: "evidence.record",
        name: "record",
        metadata: {
          facts: {
            kind: "evidence.record",
            role: "verification",
            evidenceKind: {
              classification: "custom",
              value: "custom.review",
            },
            conclusion: "passed",
            sourceForm: "inline",
            subjectMode: "explicit",
            idempotent: true,
            supersedes: true,
          },
        },
      });
      expect(JSON.stringify(result.nativeOut)).not.toMatch(
        /PROJECT_INDEX_PRIVATE_SENTINEL|private-run|private-key|private-evidence-id/,
      );
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "ignores lookalikes and wrapper calls",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["record"],
        source: [
          `import { evidence } from '@use-crux/core'`,
          `const lookalike = { record(_input: unknown) {} }`,
          `const wrapper = evidence.record`,
          `lookalike.record({ role: 'intent', kind: 'custom.fake', data: null })`,
          `wrapper({ role: 'intent', kind: 'custom.hidden', data: null })`,
        ].join("\n"),
      });

      expect(nativeFactCount(result.record, "evidence.record")).toBe(0);
      expect(
        result.nativeOut.definitions.filter(
          (definition) => definition.kind === "evidence.record",
        ),
      ).toEqual([]);
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "diagnoses only conclusive invalid literal kinds",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["record"],
        source: [
          `import { evidence } from '@use-crux/core'`,
          `declare const dynamicKind: \`custom.\${string}\``,
          `evidence.record({ role: 'intent', kind: 'bad', data: null })`,
          `evidence.record({ role: 'intent', kind: 'output', data: null })`,
          `evidence.record({ role: 'intent', kind: dynamicKind, data: null })`,
        ].join("\n"),
      });

      const definitions = result.nativeOut.definitions.filter(
        (definition) => definition.kind === "evidence.record",
      );
      expect(
        definitions.map(
          (definition) =>
            (
              definition.metadata?.facts as {
                evidenceKind: { classification: string };
              }
            ).evidenceKind.classification,
        ),
      ).toEqual(["invalid", "canonical", "unresolved"]);
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );

  itWithRustOxc(
    "matches ECMAScript Unicode boundaries for custom evidence kinds",
    async () => {
      const result = await extractNativeAndFallback({
        callNames: ["record"],
        source: [
          `import { evidence } from '@use-crux/core'`,
          `evidence.record({`,
          `  role: 'intent', kind: 'custom.a\\u0085b', data: null,`,
          `})`,
          `evidence.record({`,
          `  role: 'intent', kind: 'custom.a\\uFEFF', data: null,`,
          `})`,
        ].join("\n"),
      });

      const classifications = result.nativeOut.definitions
        .filter((definition) => definition.kind === "evidence.record")
        .map(
          (definition) =>
            (
              definition.metadata?.facts as {
                evidenceKind: { classification: string };
              }
            ).evidenceKind.classification,
        );
      expect(classifications).toEqual(["custom", "invalid"]);
      expectNativeExtractionParity(result.nativeOut, result.fallbackOut);
    },
  );
});
