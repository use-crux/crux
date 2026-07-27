import type { EvalTimeoutPolicyProjection } from "@use-crux/core/project-index";
import { formatTimeoutMs } from "@/shared/lib/format-timeout-ms";
import { T } from "./tokens";

type TimeoutValue = number | null;

interface TimeoutRow {
  readonly label: string;
  readonly value: TimeoutValue;
}

const scalarBudgets = [
  ["totalMs", "Total"],
  ["stepMs", "Step"],
  ["chunkMs", "Chunk"],
  ["firstToken", "First token"],
  ["toolMs", "Tool default"],
] as const satisfies ReadonlyArray<
  readonly [
    Exclude<keyof EvalTimeoutPolicyProjection["effective"], "tools">,
    string,
  ]
>;

function timeoutRows(
  policy: EvalTimeoutPolicyProjection | undefined,
): readonly TimeoutRow[] {
  const effective = policy?.effective;
  if (!effective) return [];

  const scalars = scalarBudgets.flatMap(([field, label]) => {
    const value = effective[field];
    return value === undefined ? [] : [{ label, value }];
  });
  const tools = Object.entries(effective.tools ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ label: `Tool · ${name}`, value }));

  return [...scalars, ...tools];
}

function TimeoutValueLabel({ value }: { readonly value: TimeoutValue }) {
  return (
    <span style={{ color: value === null ? T.fgMuted : T.fg }}>
      {value === null ? "Disabled" : formatTimeoutMs(value)}
    </span>
  );
}

/**
 * Render one Eval's effective task-timeout policy in its existing Index hero.
 *
 * @param props.policy - Canonical Project Index timeout projection.
 * @param props.evalId - Authored Eval identifier used by Evals navigation.
 * @param props.openEval - Existing Index-to-Evals navigation callback.
 */
export function EvalTimeoutPolicy({
  policy,
  evalId,
  openEval,
}: {
  readonly policy: EvalTimeoutPolicyProjection | undefined;
  readonly evalId: string;
  readonly openEval: (evalId: string) => void;
}) {
  const rows = timeoutRows(policy);

  return (
    <section aria-label="Task timeout" style={{ marginBottom: 12 }}>
      <div
        style={{
          marginBottom: 8,
          color: T.fg,
          fontFamily: T.sans,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Task timeout
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            marginBottom: 10,
            color: T.fgMuted,
            fontFamily: T.mono,
            fontSize: 11.5,
          }}
        >
          No Eval timeout policy
        </div>
      ) : (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content minmax(0, 1fr)",
            gap: "6px 16px",
            margin: "0 0 12px",
            fontFamily: T.mono,
            fontSize: 11.5,
          }}
        >
          {rows.map(({ label, value }) => (
            <div key={label} style={{ display: "contents" }}>
              <dt style={{ color: T.fgMuted }}>{label}</dt>
              <dd style={{ margin: 0 }}>
                <TimeoutValueLabel value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        onClick={() => openEval(evalId)}
        style={{
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          color: T.crux,
          fontFamily: T.mono,
          fontSize: 11.5,
        }}
      >
        Open {evalId} in Evals →
      </button>
    </section>
  );
}
