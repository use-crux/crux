import { describe, expect, it } from "vitest";

import {
  CruxRuntimeError,
  createRuntimeProgram,
  RuntimeManagedTransportContractError,
  type RuntimeManagedTransportBinding,
} from "../../src/runtime/public";

function binding(id: string, signalId: string): RuntimeManagedTransportBinding {
  return {
    _tag: "RuntimeManagedTransportBinding",
    id,
    adapter: {
      _tag: "RuntimeManagedTransportAdapter",
      id: `adapter.${id}`,
      provider: "example",
      acceptedEnvelopeVersion: 1,
    },
    configRef: { id: `config.${id}`, revision: "revision.1" },
    target: { kind: "signal", signalId },
  };
}

describe("createRuntimeProgram", () => {
  it("canonicalizes declaration order into one immutable manifest", () => {
    const first = createRuntimeProgram({
      targets: [
        { name: "orders.updated", kind: "flow" },
        { name: "orders.created", kind: "flow" },
      ],
      transports: [
        binding("updated", "orders.updated"),
        binding("created", "orders.created"),
      ],
    });
    const reordered = createRuntimeProgram({
      targets: [
        { name: "orders.created", kind: "flow" },
        { name: "orders.updated", kind: "flow" },
      ],
      transports: [
        binding("created", "orders.created"),
        binding("updated", "orders.updated"),
      ],
    });

    expect(first.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifestHash).toBe(reordered.manifestHash);
    expect(
      first.targets.map((target) =>
        "name" in target ? target.name : target.targetId,
      ),
    ).toEqual(["orders.created", "orders.updated"]);
    expect(first.transports.map((transport) => transport.id)).toEqual([
      "created",
      "updated",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.targets)).toBe(true);
    expect(Object.isFrozen(first.targetDefinitions)).toBe(true);
    expect(Object.isFrozen(first.targetDefinitions[0])).toBe(true);
    expect(Object.isFrozen(first.transports)).toBe(true);
    expect(Object.isFrozen(first.transports[0]?.adapter)).toBe(true);
    expect(Object.isFrozen(first.transports[0]?.configRef)).toBe(true);
    expect(Object.isFrozen(first.transports[0]?.target)).toBe(true);
  });

  it("includes generated definition identity in the immutable manifest", () => {
    const first = createRuntimeProgram({
      targets: [
        {
          target: { name: "orders.created" },
          definition: { id: "flow:orders-created", fingerprint: "revision-1" },
        },
      ],
      transports: [],
    });
    const changed = createRuntimeProgram({
      targets: [
        {
          target: { name: "orders.created" },
          definition: { id: "flow:orders-created", fingerprint: "revision-2" },
        },
      ],
      transports: [],
    });

    expect(first.targetDefinitions).toEqual([
      {
        targetId: "orders.created",
        definitionId: "flow:orders-created",
        fingerprint: "revision-1",
      },
    ]);
    expect(changed.manifestHash).not.toBe(first.manifestHash);
  });

  it("rejects duplicate target identities with the Runtime diagnostic shape", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [
          { name: "orders.created", kind: "flow" },
          { name: "orders.created", kind: "flow" },
        ],
        transports: [],
      }),
    ).toThrow(CruxRuntimeError);
    expect(() =>
      createRuntimeProgram({
        targets: [
          { name: "orders.created", kind: "flow" },
          { name: "orders.created", kind: "flow" },
        ],
        transports: [],
      }),
    ).toThrow(/Code: TARGET_DUPLICATE/);
  });

  it("rejects duplicate managed-binding identities", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [{ name: "orders.created", kind: "flow" }],
        transports: [
          binding("created", "orders.created"),
          binding("created", "orders.created"),
        ],
      }),
    ).toThrow(/Code: TARGET_DUPLICATE/);
  });

  it("rejects a managed binding whose Signal target is not declared", () => {
    expect(() =>
      createRuntimeProgram({
        targets: [{ name: "orders.created", kind: "flow" }],
        transports: [binding("updated", "orders.updated")],
      }),
    ).toThrow(/Code: TARGET_NOT_FOUND/);
  });

  it("reuses the managed-transport validator for malformed or live declarations", () => {
    const malformed = {
      ...binding("created", "orders.created"),
      client: new Request("https://example.test"),
    } as unknown as RuntimeManagedTransportBinding;

    expect(() =>
      createRuntimeProgram({
        targets: [{ name: "orders.created", kind: "flow" }],
        transports: [malformed],
      }),
    ).toThrow(RuntimeManagedTransportContractError);
  });

  it("rejects incompatible declarations for one adapter identity", () => {
    const created = binding("created", "orders.created");
    const updated = binding("updated", "orders.updated");

    expect(() =>
      createRuntimeProgram({
        targets: [
          { name: "orders.created", kind: "flow" },
          { name: "orders.updated", kind: "flow" },
        ],
        transports: [
          created,
          {
            ...updated,
            adapter: {
              ...updated.adapter,
              id: created.adapter.id,
              provider: "incompatible-provider",
            },
          },
        ],
      }),
    ).toThrow(/Code: CAPABILITY_MISSING/);
  });
});
