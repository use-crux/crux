import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { evalRunV3Schema, evalRunV4Schema } from "../../src/eval/node/stores";

async function goldenRun() {
  const raw = JSON.parse(
    await readFile(
      new URL("./fixtures/run-v4.golden.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  return { raw, run: evalRunV4Schema.parse(raw) };
}

/** Register the Run V4 timeout reader and strict coupling validation. */
export function runV4StoreBehavior(): void {
  it("validates V4 timeout evidence while retaining the V3 reader", async () => {
    const { raw, run } = await goldenRun();

    expect(run).toMatchObject({
      schemaVersion: 4,
      status: "complete",
      passed: false,
      cells: [
        {
          status: "timed_out",
          task: { status: "timed_out" },
          timeout: { budget: "total", limitMs: 25 },
          scorerContracts: [
            { name: "helpful", contractFingerprint: "helpful-v1" },
          ],
        },
      ],
      aggregates: {
        current: {
          cells: 1,
          passed: 0,
          failed: 0,
          errored: 0,
          timedOut: 1,
        },
      },
    });
    expect(evalRunV3Schema.safeParse(raw).success).toBe(false);
  });

  it("rejects malformed V4 timeout coupling and active aggregates", async () => {
    const { run } = await goldenRun();
    const cell = run.cells[0]!;
    const aggregate = run.aggregates.current!;
    const { timeout: _timeout, ...withoutTimeout } = cell;
    const malformed = [
      {
        name: "missing scorer catalog",
        run: {
          ...run,
          cells: [
            Object.fromEntries(
              Object.entries(cell).filter(([key]) => key !== "scorerContracts"),
            ),
          ],
        },
      },
      {
        name: "malformed scorer catalog",
        run: {
          ...run,
          cells: [
            {
              ...cell,
              scorerContracts: [{ name: "", contractFingerprint: "" }],
            },
          ],
        },
      },
      { name: "missing timeout", run: { ...run, cells: [withoutTimeout] } },
      {
        name: "zero limit",
        run: {
          ...run,
          cells: [{ ...cell, timeout: { budget: "total", limitMs: 0 } }],
        },
      },
      {
        name: "tool budget without name",
        run: {
          ...run,
          cells: [{ ...cell, timeout: { budget: "tool", limitMs: 25 } }],
        },
      },
      {
        name: "non-tool budget with name",
        run: {
          ...run,
          cells: [
            {
              ...cell,
              timeout: {
                budget: "total",
                limitMs: 25,
                toolName: "search",
              },
            },
          ],
        },
      },
      {
        name: "impossible active aggregate",
        run: {
          ...run,
          aggregates: {
            ...run.aggregates,
            current: { ...aggregate, timedOut: 0 },
          },
        },
      },
    ];

    expect(
      malformed.map(({ name, run: candidate }) => ({
        name,
        accepted: evalRunV4Schema.safeParse(candidate).success,
      })),
    ).toEqual(malformed.map(({ name }) => ({ name, accepted: false })));
  });
}
