import { describe, expect, it } from "vitest";

import {
  BridgeCapabilitySchema,
  BridgeCommandRequestSchema,
  PromptPreviewResultEnvelopeSchema,
} from "../../src/runtime-bridge";

describe("exact prompt preview protocol", () => {
  it("keeps store.read compatible while preview objects are recursively strict", () => {
    expect(
      BridgeCapabilitySchema.parse({
        command: "store.read",
        resources: [],
        legacyExtension: true,
      }),
    ).toEqual({ command: "store.read", resources: [] });

    expect(() =>
      BridgeCapabilitySchema.parse({
        command: "prompt.previewExact",
        catalogueRevision: 1,
        targets: [
          {
            definitionId: "prompt:greeting",
            kind: "prompt",
            name: "greeting",
            input: { mode: "none", unknown: true },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects unknown request and result fields, including run identifiers", () => {
    const request = {
      type: "command.request",
      commandId: "cmd",
      command: "prompt.previewExact",
      targetId: "prompt:greeting",
      catalogueRevision: 1,
      payload: { input: {} },
      deadlineMs: 1_000,
    } as const;

    expect(BridgeCommandRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      BridgeCommandRequestSchema.parse({
        ...request,
        payload: { input: {}, tools: {} },
      }),
    ).toThrow();
    expect(() =>
      PromptPreviewResultEnvelopeSchema.parse({
        type: "command.result",
        commandId: "cmd",
        result: {
          status: "validation-error",
          targetId: "prompt:greeting",
          catalogueRevision: 1,
          issues: [],
          omittedIssueCount: 0,
        },
        runIds: [],
      }),
    ).toThrow();
  });

  it("accepts exact scalar and numeric request bounds and rejects overflow", () => {
    const request = {
      type: "command.request",
      commandId: "c".repeat(128),
      command: "prompt.previewExact",
      targetId: "t".repeat(512),
      catalogueRevision: Number.MAX_SAFE_INTEGER,
      payload: {
        input: {},
        options: {
          provider: "p".repeat(128),
          modelId: "m".repeat(256),
          tokenBudget: 1_000_000,
        },
      },
      deadlineMs: 30_000,
    } as const;
    expect(BridgeCommandRequestSchema.parse(request)).toEqual(request);

    for (const overflow of [
      { ...request, commandId: `${request.commandId}c` },
      { ...request, targetId: `${request.targetId}t` },
      { ...request, catalogueRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, deadlineMs: 30_001 },
      {
        ...request,
        payload: {
          ...request.payload,
          options: {
            ...request.payload.options,
            provider: `${request.payload.options.provider}p`,
          },
        },
      },
      {
        ...request,
        payload: {
          ...request.payload,
          options: {
            ...request.payload.options,
            modelId: `${request.payload.options.modelId}m`,
          },
        },
      },
      {
        ...request,
        payload: {
          ...request.payload,
          options: {
            ...request.payload.options,
            tokenBudget: 1_000_001,
          },
        },
      },
    ]) {
      expect(() => BridgeCommandRequestSchema.parse(overflow)).toThrow();
    }
  });
});
