# Media classifier guardrail — lifecycle and delivery plan

Status: **ready after Tasks 1–7 in the
[Core and adapter plan](./2026-07-26-media-classifier-guardrail-plan.md)**

Specifications:

- [Design](../specs/2026-07-26-media-classifier-guardrail-design.md)
- [Evidence and indexing contract](../specs/2026-07-26-media-classifier-evidence-and-indexing-contract.md)
- [Delivery contract](../specs/2026-07-26-media-classifier-delivery-contract.md)

Use the same red-green-refactor protocol as the primary plan. Keep every new
source and test file below 300 lines.

## Task 8: prove lifecycle parity

Add `packages/core/__tests__/safety/media-classifier-lifecycle.test.ts` and
drive all cases through public Safety entry points:

- input and completed output;
- image, audio, video, and file/document;
- media-only input/output tuple;
- stable multiple-part traversal and exactly one call per included part;
- modality narrowing, disabled tuning, report mode, and failures in report;
- warn/block/strip and required-group strip escalation;
- no hidden URL download or `AssetRef` hydration; and
- original provider options never crossing the disclosure boundary.

Use the existing media matrix/testing helpers where they express the invariant.
Do not add cases to the 400-plus-line `guardrail.test.ts`.

## Task 9: add Project Index support

**Red**

- Add focused cases in
  `packages/indexer/__tests__/safety-guardrail-strategy.test.ts`; split to
  `safety-media-classifier-strategy.test.ts` if the original approaches 300
  lines.
- Prove helper kind extraction for literal and dynamic options.
- Prove only safe literal config is projected; generator/model/descriptions are
  absent.
- Prove Rust/Oxc and fallback output parity.

**Green/refactor**

- Add `mediaClassifier` to the guardrail helper kinds in
  `crates/primitives/src/safety/metadata.rs`.
- Project an explicit safe allowlist rather than serializing the entire options
  object; do not rely on the existing generic config copier for this helper.
- Update Rust/static golden fixtures through repository generators.
- Audit `packages/indexer/src/indexer/cache-identity.ts`: update structured
  extractor identity when already hashed, otherwise bump
  `STATIC_PARSE_CACHE_EPOCH`.
- Do not change semantic or Go snapshot epochs unless owned output changes.

Run the focused Indexer test, contract check, package typecheck, and relevant
Rust tests.

## Task 10: documentation, migration, and release

- Add `apps/docs/content/docs/guides/safety/media-classifier.mdx`; keep
  `guardrails.mdx` to a short conceptual link if it is already large.
- Update `apps/docs/content/docs/guides/safety/meta.json` and the Core Safety
  reference.
- Show equal OpenAI, Anthropic, Google GenAI, and AI SDK examples.
- Explain the classifier-provider disclosure boundary, cross-provider file
  reference portability, documents as `file`, excluded versus unsupported,
  report-mode error behavior, and bridge recursion risk.
- Document `createGenerateObjectFn(client, model)` to
  `createGenerateObjectFn(client)` migration and authoritative per-call model.
- Update the existing relevant changeset, or create one only if none owns the
  release theme. Include directly affected packages and the repository's
  breaking classification.

Use concise Next.js/AI SDK-style JSDoc and docs: lead with purpose, show the
common path first, put defaults beside options, and make failure behavior
discoverable without provider-specific framing.

## Final verification and acceptance

Run:

```sh
pnpm --filter @use-crux/core test
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/openai test && pnpm --filter @use-crux/openai typecheck
pnpm --filter @use-crux/anthropic test && pnpm --filter @use-crux/anthropic typecheck
pnpm --filter @use-crux/google test && pnpm --filter @use-crux/google typecheck
pnpm --filter @use-crux/ai test && pnpm --filter @use-crux/ai typecheck
pnpm --filter @use-crux/indexer test
pnpm --filter @use-crux/indexer typecheck
pnpm --filter docs build
make typecheck
make test
make build
```

Acceptance requires all four adapters to pass the same canonical contract,
error identities to remain intact, handled fail-open to remain visible, no
media or rubric text in telemetry/index facts, every touched concern to stay
focused, and no new source/test file to exceed 300 lines.
