import type { ProjectIdentity } from "@/types";

interface ObservabilityPrivacyCardProps {
  /** Effective project policy reported by the config-aware local index. */
  observability: ProjectIdentity["observability"] | undefined;
}

/**
 * Project-level visibility for declarative observability redaction policy.
 *
 * This intentionally renders only configured, known-empty, or unavailable.
 * Pattern details and application evidence belong outside the Catalog.
 */
export function ObservabilityPrivacyCard({
  observability,
}: ObservabilityPrivacyCardProps) {
  const state = privacyState(observability);

  return (
    <section
      aria-labelledby="observability-privacy-heading"
      className="flex flex-none items-center justify-between gap-5 border-b px-5 py-3"
      style={{
        borderColor: "var(--devtools-border)",
        background: "var(--devtools-bg-elev)",
      }}
    >
      <div className="min-w-0">
        <h2
          id="observability-privacy-heading"
          className="m-0 text-xs font-semibold"
          style={{ color: "var(--devtools-fg)" }}
        >
          Observability privacy
        </h2>
        <p
          className="m-0 mt-1 text-[11px] leading-4"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {state.copy}
        </p>
      </div>
      <span
        className="shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium"
        style={{
          borderColor: "var(--devtools-border-strong)",
          background: "var(--devtools-bg-muted)",
          color: "var(--devtools-fg-muted)",
        }}
      >
        {state.badge}
      </span>
    </section>
  );
}

function privacyState(
  observability: ProjectIdentity["observability"] | undefined,
): { readonly badge: string; readonly copy: string } {
  if (observability?.redactPatternsConfigured === true) {
    return {
      badge: "Pattern redaction configured",
      copy: "Crux will apply these declarative patterns to captured telemetry. Runs show when a pattern actually changed a record.",
    };
  }
  if (observability?.redactPatternsConfigured === false) {
    return {
      badge: "No redaction patterns",
      copy: "No declarative telemetry redaction patterns are configured. Other capture controls may still apply.",
    };
  }
  return {
    badge: "Status unavailable",
    copy: "Crux could not determine the effective observability privacy config. Reindex the project or check config-load diagnostics.",
  };
}
