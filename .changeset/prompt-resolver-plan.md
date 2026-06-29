---
'@use-crux/core': minor
---

Deepen the core prompt-resolution pipeline behind one private pass primitive and complete the resolver-port seam.

- Introduce `createPromptResolverPlan(config, ports)` — the single private pass primitive. `compilePrompt()` is now a thin boundary that validates the config, binds ports, and projects `resolve()` / `inspect()` over the plan's one `run(opts, mode)` call, so the two projections can never drift across ordering, gating, skills, budget, settings, or inspection.
- Add a `TokenizerPort` (`{ count(text) }`): every token count the pipeline reports (system parts, prompt text, dropped contexts) now flows through it, so a deterministic counter pins token-budget behavior without depending on the production chars/4 estimate.
- Broaden the `skills` port to own registry fetch **plus** skill-index generation and activation-session creation — the resolution pass no longer imports the skill module directly.
- Add `createResolverFakes()`: a one-call bundle of deterministic in-memory ports (observability, skills, cache, clock, tokenizer, policy, diagnostics, instrumentation), each also exposed as a named handle for assertions. New `staticTokenizer()` fake.
- `compilePrompt()` now returns a `PromptResolutionPipeline`; `CompiledPrompt` remains as a deprecated alias. New public exports: `PromptResolutionPipeline`, `TokenizerPort`, `staticTokenizer`, `createResolverFakes`, `ResolverFakes`, `ResolverFakesOptions`.
- Internal-only refactor of the resolution internals (split port contracts in `resolver/ports.ts` from their production adapters in `resolver/default-ports.ts`). No change to the `prompt().resolve()` / `prompt().inspect()` runtime behavior or to resolved prompt args.
