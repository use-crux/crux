import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadGeneratedEvalPersistencePolicy,
  loadProjectEvalSettings,
} from "../../src/eval/node/project-settings";
import {
  fingerprintEvalPersistencePolicy,
  normalizeEvalPersistencePolicy,
} from "../../src/eval/internal/redact";

describe("project Eval settings", () => {
  it("loads data-only redaction policy with config side effects disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-eval-settings-"));
    await writeFile(
      join(root, "crux.config.mjs"),
      [
        "if (process.env.CRUX_INDEX !== '1') throw new Error('config was not inert')",
        "export default { config: { observability: {",
        "  redactPaths: ['customer.email', 'token', 'customer.email'],",
        "} } }",
      ].join("\n"),
    );

    await expect(loadProjectEvalSettings(root)).resolves.toMatchObject({
      persistencePolicy: {
        redactPaths: ["customer.email", "token"],
      },
    });
  });

  it("rejects ambiguous project configuration before importing either file", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-eval-settings-"));
    await mkdir(root, { recursive: true });
    await Promise.all([
      writeFile(join(root, "crux.config.js"), "export default {}\n"),
      writeFile(join(root, "crux.config.mjs"), "export default {}\n"),
    ]);

    await expect(loadProjectEvalSettings(root)).rejects.toThrow(/ambiguous/i);
  });

  it("loads the generated privacy projection without importing project code", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-eval-settings-"));
    const policy = normalizeEvalPersistencePolicy({
      redactPaths: ["customer.email"],
    });
    const generated = join(root, ".crux/generated/runtime");
    await mkdir(generated, { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "crux.config.mjs"),
        "throw new Error('project code was imported')\n",
      ),
      writeFile(
        join(generated, "privacy.json"),
        JSON.stringify({
          schemaVersion: 1,
          privacyFingerprint: fingerprintEvalPersistencePolicy(policy),
          redactPaths: policy.redactPaths,
        }),
      ),
    ]);

    await expect(
      loadGeneratedEvalPersistencePolicy(root),
    ).resolves.toEqual(policy);
  });

  it("fails closed when the generated privacy projection is missing or stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-eval-settings-"));
    await expect(loadGeneratedEvalPersistencePolicy(root)).rejects.toThrow(
      /crux runtime generate/i,
    );
    const generated = join(root, ".crux/generated/runtime");
    await mkdir(generated, { recursive: true });
    await writeFile(
      join(generated, "privacy.json"),
      JSON.stringify({
        schemaVersion: 1,
        privacyFingerprint: "stale",
        redactPaths: ["customer.email"],
      }),
    );
    await expect(loadGeneratedEvalPersistencePolicy(root)).rejects.toThrow(
      /crux runtime generate/i,
    );
  });
});
