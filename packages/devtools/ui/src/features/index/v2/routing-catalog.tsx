import { T } from "./tokens";
import type { IndexFacts } from "./adapt";

/**
 * Renders routing-only catalog metadata shared by parent heroes and route rows.
 *
 * The input is the adapter's permissive read view so static, semantic, and
 * persisted Project Index records use the same presentation boundary.
 */
export function RoutingCatalogFacts({
  compact = false,
  facts,
}: {
  readonly compact?: boolean;
  readonly facts?: IndexFacts;
}) {
  if (!facts?.kind?.startsWith("routing.")) return null;
  const profileEntries = Object.entries(facts.profile ?? {});
  const hasContext = facts.routingContextType !== undefined;
  if (compact && profileEntries.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        minWidth: 0,
        fontFamily: T.mono,
        fontSize: 10.5,
      }}
    >
      {!compact && <span style={{ color: T.fgFaint }}>{facts.kind}</span>}
      {hasContext && (
        <span style={{ color: T.fgMuted }}>
          context {facts.routingContextRequired ? "required" : "optional"}
          <code
            style={{
              color: T.fg,
              marginLeft: 6,
              overflowWrap: "anywhere",
            }}
          >
            {facts.routingContextType}
          </code>
        </span>
      )}
      {profileEntries.length > 0 && (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: T.fgFaint }}>profile</span>
          {profileEntries.map(([key, value]) => (
            <code key={key} style={{ color: T.fg }}>
              {key}={formatProfileValue(value)}
            </code>
          ))}
        </span>
      )}
    </div>
  );
}

function formatProfileValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
