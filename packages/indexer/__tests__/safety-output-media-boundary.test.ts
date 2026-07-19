import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

describe("output media safety boundary indexing", () => {
  itWithRustOxc(
    "extracts model.output.media through the native static contract",
    async () => {
      const { nativeOut, record } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          "",
          "export const generatedMedia = guardrail({",
          "  id: 'generated-media',",
          "  on: boundary.output.media(),",
          "  run: () => ({ action: 'allow' as const }),",
          "})",
        ].join("\n"),
        callNames: ["guardrail"],
      });

      expect(
        nativeOut.definitions.find(
          (item) => item.id === "guardrail:generated-media",
        ),
      ).toMatchObject({
        metadata: {
          boundary: "model.output.media",
          boundaries: ["model.output.media"],
          facts: {
            boundary: "model.output.media",
            boundaries: ["model.output.media"],
          },
        },
      });
      expect(
        record.nativeFacts?.flatMap((fact) => fact.replaces ?? []),
      ).toContainEqual({
        extension: "@use-crux/indexer/crux-core",
        extractor: "safety",
      });
    },
    90_000,
  );

  itWithRustOxc(
    "preserves an input/output media tuple in authored order",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          "",
          "export const portableMedia = guardrail({",
          "  id: 'portable-media',",
          "  on: [boundary.input.media(), boundary.output.media()] as const,",
          "  run: () => ({ action: 'allow' as const }),",
          "})",
        ].join("\n"),
        callNames: ["guardrail"],
      });

      expect(
        nativeOut.definitions.find(
          (item) => item.id === "guardrail:portable-media",
        ),
      ).toMatchObject({
        metadata: {
          boundary: "user.input.media",
          boundaries: ["user.input.media", "model.output.media"],
          facts: {
            boundary: "user.input.media",
            boundaries: ["user.input.media", "model.output.media"],
          },
        },
      });
    },
    90_000,
  );

  itWithRustOxc(
    "keeps guardrail.media strategy metadata on the output boundary",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: [
          "import { boundary, guardrail } from '@use-crux/core/safety'",
          "",
          "export const generatedMedia = guardrail({",
          "  id: 'generated-media-strategy',",
          "  on: boundary.output.media(),",
          "  run: guardrail.media({",
          "    mediaTypes: { allow: ['image/png'] },",
          "    action: 'strip',",
          "  }),",
          "})",
        ].join("\n"),
        callNames: ["guardrail", "media"],
      });

      expect(
        nativeOut.definitions.find(
          (item) => item.id === "guardrail:generated-media-strategy",
        ),
      ).toMatchObject({
        metadata: {
          boundary: "model.output.media",
          strategy: {
            kind: "media",
            config: {
              mediaTypes: { allow: ["image/png"] },
              action: "strip",
            },
          },
          facts: {
            boundary: "model.output.media",
            strategy: {
              kind: "media",
              config: {
                mediaTypes: { allow: ["image/png"] },
                action: "strip",
              },
            },
          },
        },
      });
    },
    90_000,
  );

  itWithRustOxc(
    "indexes completed-operation policy and safety option references",
    async () => {
      const { fallbackOut, nativeOut, typescriptOut } =
        await extractNativeAndFallback({
          source: [
            "import { transcribe } from '@use-crux/ai'",
            "import { boundary, constraint, guardrail } from '@use-crux/core/safety'",
            "",
            "const mediaPolicy = guardrail({",
            "  id: 'media-policy',",
            "  on: boundary.input.media(),",
            "  run: () => ({ action: 'allow' as const }),",
            "})",
            "const transcriptCheck = constraint({",
            "  id: 'transcript-check',",
            "  on: boundary.output.text(),",
            "  run: () => ({ pass: true }),",
            "})",
            "const safetyOptions = { tune: { 'media-policy': { mode: 'report' as const } } }",
            "",
            "export const transcript = transcribe({",
            "  model: 'transcription-model',",
            "  audio: inputAudio,",
            "  guardrails: [mediaPolicy],",
            "  constraints: [transcriptCheck],",
            "  safety: safetyOptions,",
            "})",
          ].join("\n"),
          callNames: ["constraint", "guardrail", "transcribe"],
        });

      expect(nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "guardrail.applies_to",
            from: "guardrail:media-policy",
            to: "media.operation:transcript",
          }),
          expect.objectContaining({
            type: "constraint.applies_to",
            from: "constraint:transcript-check",
            to: "media.operation:transcript",
          }),
        ]),
      );
      for (const output of [nativeOut, fallbackOut, typescriptOut]) {
        const operation = output.definitions.find(
          (item) => item.id === "media.operation:transcript",
        );
        expect(operation?.sourceRefs).toContainEqual(
          expect.objectContaining({
            role: "config",
            property: "safety",
            symbol: "safetyOptions",
          }),
        );
      }
    },
    90_000,
  );
});
