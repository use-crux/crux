import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText diagnostic scope", () => {
  it("does not infer blocked encoding, trust, or nested-input semantics", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const sanitize = "sanitize"`,
        `const sanitization = "sanitization"`,
        `const encode = "encode"`,
        `const encoding = "encoding"`,
        `const escape = "escape"`,
        `const escaping = "escaping"`,
        `const trust = "trust"`,
        `const trusted = "trusted"`,
        `const raw = "raw"`,
        `const xml = "xml"`,
        `const safe = "safe"`,
        `const safety = "safety"`,
        `const nestedInput = "nested input"`,
        `const doubleEncoding = "double-encoding"`,
        `export const writer = prompt({`,
        `  id: "writer",`,
        `  prompt: md\`\${sanitize}\${sanitization}\${encode}\${encoding}\${escape}\${escaping}\${trust}\${trusted}\${raw}\${xml}\${safe}\${safety}\${nestedInput}\${doubleEncoding}\`,`,
        `})`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([]);
    expect(facts.lintFindings ?? []).toEqual([]);
  });
});
