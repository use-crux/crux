import type { EvalTimeoutPolicyProjection } from "@use-crux/core/project-index";
import { Chip } from "@/devtools/shell/primitives";
import { formatTimeoutMs } from "@/shared/lib/format-timeout-ms";
import type { EvalCatalogEntry } from "../types";

type CatalogCase = EvalCatalogEntry["cases"][number];
type TimeoutValue = number | null;

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
): readonly { readonly label: string; readonly value: TimeoutValue }[] {
  const effective = policy?.effective;
  if (!effective) return [];
  return [
    ...scalarBudgets.flatMap(([field, label]) => {
      const value = effective[field];
      return value === undefined ? [] : [{ label, value }];
    }),
    ...Object.entries(effective.tools ?? {}).map(([name, value]) => ({
      label: `Tool · ${name}`,
      value,
    })),
  ];
}

function EffectivePolicyRows({
  policy,
}: {
  readonly policy: EvalTimeoutPolicyProjection | undefined;
}) {
  const rows = timeoutRows(policy);
  if (rows.length === 0) {
    return (
      <p
        className="font-mono text-[11px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        No Eval timeout policy
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[11px]">
      {rows.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt style={{ color: "var(--devtools-fg-muted)" }}>{label}</dt>
          <dd className="m-0">
            {value === null ? "Disabled" : formatTimeoutMs(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Render the selected Eval's compact effective default timeout policy. */
export function EvalTimeoutPolicy({
  policy,
}: {
  readonly policy: EvalTimeoutPolicyProjection | undefined;
}) {
  return (
    <section className="mt-5 space-y-2">
      <h3
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Task timeout
      </h3>
      <EffectivePolicyRows policy={policy} />
    </section>
  );
}

function inheritanceLabel(policy: EvalTimeoutPolicyProjection | undefined) {
  if (policy === undefined || !Object.hasOwn(policy, "authored")) {
    return "Inherits Eval policy";
  }
  return policy.authored === null
    ? "Clears Eval policy"
    : "Overrides Eval policy";
}

/** Render one hydrated Case's override intent and effective policy disclosure. */
export function EvalCaseTimeoutSummary({
  item,
}: {
  readonly item: CatalogCase;
}) {
  const summary = inheritanceLabel(item.timeout);
  const label = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[12px]">{item.id}</span>
      <Chip tone={summary === "Clears Eval policy" ? "warn" : "muted"}>
        {summary}
      </Chip>
      {item.unvalidatedExpected ? (
        <Chip tone="warn">expected unvalidated</Chip>
      ) : null}
    </span>
  );

  return item.timeout === undefined ? (
    <div>{label}</div>
  ) : (
    <details
      className="rounded-[7px] p-2"
      style={{ border: "1px solid var(--devtools-border)" }}
    >
      <summary className="cursor-pointer list-none">{label}</summary>
      <div className="mt-2 pl-2">
        <EffectivePolicyRows policy={item.timeout} />
      </div>
    </details>
  );
}

/** Render timeout configuration for a selected Eval and all hydrated Cases. */
export function EvalCatalogTimeoutPolicies({
  entry,
}: {
  readonly entry: EvalCatalogEntry;
}) {
  return (
    <>
      <EvalTimeoutPolicy policy={entry.timeout} />
      <h3
        className="mt-5 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Cases
      </h3>
      <div className="mt-2 space-y-1.5">
        {entry.cases.map((item) => (
          <EvalCaseTimeoutSummary key={item.id} item={item} />
        ))}
      </div>
    </>
  );
}
