import { DevtoolsConfirm } from "@/devtools/shell/DevtoolsConfirm";
import { Btn } from "@/devtools/shell/primitives";

export function EvalRunAction({
  evalId,
  pending,
  error,
  onRun,
}: {
  readonly evalId: string;
  readonly pending: boolean;
  readonly error?: string;
  readonly onRun: () => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      <DevtoolsConfirm
        title={`Run ${evalId}?`}
        description={
          <>
            Crux reuses exact evidence automatically. If this run needs model
            or judge calls with an unknown maximum cost, continuing explicitly
            confirms those calls. Runtime readiness and all other preflight
            checks still apply.
          </>
        }
        confirmLabel="Run Eval"
        tone="crux"
        onConfirm={onRun}
      >
        <Btn variant="primary" disabled={pending}>
          {pending ? "Running…" : "Run Eval"}
        </Btn>
      </DevtoolsConfirm>
      {error ? (
        <p
          role="alert"
          className="text-[12px] leading-5"
          style={{ color: "var(--devtools-danger)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
