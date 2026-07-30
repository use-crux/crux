import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  canonicalEvidenceCandidateV1,
  evidenceCandidateDigestV1,
  type EvidenceCandidateV1,
} from "../../src/evidence/candidate-v1";

const evidenceId = "evidence_1111111111111111" as const;

interface CandidateFixture {
  readonly cases: readonly {
    readonly name: string;
    readonly candidate: EvidenceCandidateV1;
    readonly expectedBytes: number;
    readonly expectedDigest: `sha256:${string}`;
  }[];
  readonly boundary: {
    readonly candidate: EvidenceCandidateV1 & {
      readonly preview: { readonly padding: string };
    };
    readonly maximumBytes: number;
    readonly acceptedPaddingBytes: number;
    readonly oversizedPaddingBytes: number;
  };
}

describe("evidence staging candidate V1", () => {
  it.each([
    {
      name: "present null preview",
      candidate: {
        version: 1,
        evidenceId,
        evidenceKind: "score.report",
        captureState: "available",
        preview: null,
      },
      canonical:
        '{"captureState":"available","evidenceId":"evidence_1111111111111111","evidenceKind":"score.report","preview":null,"version":1}',
    },
    {
      name: "absent reference metadata",
      candidate: {
        version: 1,
        evidenceId,
        evidenceKind: "score.report",
        captureState: "reference",
      },
      canonical:
        '{"captureState":"reference","evidenceId":"evidence_1111111111111111","evidenceKind":"score.report","version":1}',
    },
    {
      name: "present zero size",
      candidate: {
        version: 1,
        evidenceId,
        evidenceKind: "score.report",
        captureState: "reference",
        hash: `sha256:${"a".repeat(64)}`,
        sizeBytes: 0,
      },
      canonical:
        `{"captureState":"reference","evidenceId":"evidence_1111111111111111","evidenceKind":"score.report","hash":"sha256:${"a".repeat(64)}","sizeBytes":0,"version":1}`,
    },
    {
      name: "integer-like keys",
      candidate: {
        version: 1,
        evidenceId,
        evidenceKind: "score.report",
        captureState: "available",
        preview: { "2": "two", "10": "ten", a: true },
      },
      canonical:
        '{"captureState":"available","evidenceId":"evidence_1111111111111111","evidenceKind":"score.report","preview":{"10":"ten","2":"two","a":true},"version":1}',
    },
    {
      name: "Unicode",
      candidate: {
        version: 1,
        evidenceId,
        evidenceKind: "score.report",
        captureState: "available",
        preview: { separator: "line\u2028paragraph\u2029", café: "☕" },
      },
      canonical:
        '{"captureState":"available","evidenceId":"evidence_1111111111111111","evidenceKind":"score.report","preview":{"caf%C3%A9":"%E2%98%95","separator":"line\\u2028paragraph\\u2029"},"version":1}',
    },
  ] satisfies readonly {
    readonly name: string;
    readonly candidate: EvidenceCandidateV1;
    readonly canonical: string;
  }[])("$name has a pinned canonical representation", ({ candidate, canonical }) => {
    const expected = decodeURIComponent(canonical);
    expect(new TextDecoder().decode(canonicalEvidenceCandidateV1(candidate))).toBe(
      expected,
    );
    expect(evidenceCandidateDigestV1(candidate)).toMatch(
      /^sha256:[0-9a-f]{64}$/u,
    );
  });

  it("is independent of object field order", () => {
    const left: EvidenceCandidateV1 = {
      version: 1,
      evidenceId,
      evidenceKind: "score.report",
      captureState: "available",
      preview: { z: 1, a: 2 },
    };
    const right = {
      preview: { a: 2, z: 1 },
      captureState: "available",
      evidenceKind: "score.report",
      evidenceId,
      version: 1,
    } satisfies EvidenceCandidateV1;

    expect(evidenceCandidateDigestV1(left)).toBe(
      evidenceCandidateDigestV1(right),
    );
  });

  it("matches the shared TypeScript/Go golden and exact byte boundary", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../../src/evidence/fixtures/candidate-v1.json", import.meta.url),
        "utf8",
      ),
    ) as CandidateFixture;

    for (const testCase of fixture.cases) {
      expect(canonicalEvidenceCandidateV1(testCase.candidate)).toHaveLength(
        testCase.expectedBytes,
      );
      expect(evidenceCandidateDigestV1(testCase.candidate)).toBe(
        testCase.expectedDigest,
      );
    }

    const atLimit = {
      ...fixture.boundary.candidate,
      preview: { padding: "x".repeat(fixture.boundary.acceptedPaddingBytes) },
    } satisfies EvidenceCandidateV1;
    const overLimit = {
      ...fixture.boundary.candidate,
      preview: { padding: "x".repeat(fixture.boundary.oversizedPaddingBytes) },
    } satisfies EvidenceCandidateV1;
    expect(canonicalEvidenceCandidateV1(atLimit)).toHaveLength(
      fixture.boundary.maximumBytes,
    );
    expect(canonicalEvidenceCandidateV1(overLimit)).toHaveLength(
      fixture.boundary.maximumBytes + 1,
    );
  });
});
