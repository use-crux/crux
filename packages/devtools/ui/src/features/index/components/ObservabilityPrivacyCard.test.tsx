import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ObservabilityPrivacyCard } from "./ObservabilityPrivacyCard";

describe("ObservabilityPrivacyCard", () => {
  it("renders the configured effective-policy state without policy detail", () => {
    const html = renderToStaticMarkup(
      <ObservabilityPrivacyCard
        observability={{ redactPatternsConfigured: true }}
      />,
    );

    expect(html).toContain("Observability privacy");
    expect(html).toContain("Pattern redaction configured");
    expect(html).toContain(
      "Runs show when a pattern actually changed a record.",
    );
    expect(html).not.toMatch(
      /rule count|pattern count|replacement|regular expression|ACME/i,
    );
  });

  it("renders the known-empty state neutrally", () => {
    const html = renderToStaticMarkup(
      <ObservabilityPrivacyCard
        observability={{ redactPatternsConfigured: false }}
      />,
    );

    expect(html).toContain("No redaction patterns");
    expect(html).toContain("Other capture controls may still apply.");
  });

  it("renders unknown as unavailable rather than disabled", () => {
    const html = renderToStaticMarkup(
      <ObservabilityPrivacyCard observability={undefined} />,
    );

    expect(html).toContain("Status unavailable");
    expect(html).toContain(
      "Reindex the project or check config-load diagnostics.",
    );
    expect(html).not.toContain("No redaction patterns");
  });
});
