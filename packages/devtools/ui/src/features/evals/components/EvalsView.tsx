import { useNavigation } from "@/app/navigation/useNavigation";
import { navTarget } from "@/app/navigation/navTarget";
import { useConnected } from "@/app/runtime/runtimeStore";
import { QwShell } from "@/qw/shell/QwShell";
import { Chip } from "@/qw/shell/primitives";
import { QEmpty } from "@/qw/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useEvalCatalog } from "../hooks/useEvals";

export function EvalsView({ evalId }: { evalId?: string }) {
  const connected = useConnected();
  const { navigate } = useNavigation();
  const query = useEvalCatalog();
  const entries = query.data ?? [];
  const selected = entries.find((entry) => entry.id === evalId);
  return (
    <QwShell
      activeView="evals"
      onNavigate={(view) => navigate(navTarget(view))}
      breadcrumb="Evals"
      title="Evals"
      subtitle={`${entries.length} discovered definitions`}
      connected={connected}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
        <div className="space-y-3">
          {query.isPending ? (
            <SkeletonRows rows={4} rowHeight={72} />
          ) : query.isError ? (
            <QEmpty
              icon="alert"
              title="Eval discovery failed"
              body={query.error.message}
            />
          ) : entries.length === 0 ? (
            <QEmpty
              icon="layers"
              title="No Evals discovered"
              body="Add a default-exported *.eval.ts definition to this project."
            />
          ) : (
            entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => navigate({ view: "evals", evalId: entry.id })}
                className="block w-full cursor-pointer rounded-[10px] px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{
                  background: "var(--qw-bg-elev)",
                  border: "1px solid var(--qw-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold">
                    {entry.id}
                  </span>
                  <Chip tone="muted">{entry.cases.length} Cases</Chip>
                  <Chip tone="muted">
                    {Math.max(0, entry.variants.length - 1)} Variants
                  </Chip>
                </div>
                <div
                  className="mt-1.5 font-mono text-[11px]"
                  style={{ color: "var(--qw-fg-muted)" }}
                >
                  {entry.sourceKey.relativeFile}
                </div>
              </button>
            ))
          )}
        </div>
        <aside
          className="rounded-[10px] p-4"
          style={{
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
          }}
        >
          {selected ? (
            <>
              <h2 className="font-mono text-[14px] font-semibold">
                {selected.id}
              </h2>
              {selected.description && (
                <p className="mt-2 text-[13px] leading-6">
                  {selected.description}
                </p>
              )}
              <h3
                className="mt-5 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--qw-fg-muted)" }}
              >
                Cases
              </h3>
              <div className="mt-2 space-y-1.5">
                {selected.cases.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 font-mono text-[12px]"
                  >
                    <span>{item.id}</span>
                    {item.unvalidatedExpected && (
                      <Chip tone="warn">expected unvalidated</Chip>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px]" style={{ color: "var(--qw-fg-muted)" }}>
              Select an Eval to inspect its source, Cases, and Variants.
            </p>
          )}
        </aside>
      </div>
    </QwShell>
  );
}
