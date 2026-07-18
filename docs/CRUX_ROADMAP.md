# Crux Roadmap

Crux is a context-engineering SDK: authored AI definitions, the Runtime that
executes them, the observability evidence that explains them, and Evals that
protect them. The roadmap closes gaps between those layers before adding new
primitive breadth.

## Product rules

- Explicit construction decides production behavior; discovery provides
  visibility.
- Users learn five Eval concepts: Eval, Case, Variant, Eval run, and Baseline.
- Crux owns planning, exact evidence reuse, comparison, and explanation. The
  production task still runs in its real host.
- Missing configuration fails before spend with one actionable next step.
- Source is authored truth. Runtime records and Eval evidence enrich it but do
  not rewrite it.
- Privacy, cost, and external data movement require explicit policy.

## Shipped foundation

- Typed prompts, contexts, tools, memory, retrieval, safety, routing, agents,
  flows, plans, tasks, and provider adapters.
- A source-linked Project Index with diagnostics, relations, lints, and runtime
  joins.
- A canonical observability graph with local Devtools, CLI inspection, and
  OpenTelemetry export.
- Durable Runtime hosts for Node, serverless, Workers, and Convex.
- Crux Evals: inert Vitest-like definitions, typed Cases and Variants,
  automatic minimal-work reuse, explicit Baselines, run-linked feedback, and
  Review.

## Now: launch confidence

The launch bar is one coherent path rather than a collection of APIs:

1. Define a production task once with `generate.task()` or `stream.task()`.
2. Add a `*.eval.ts` file with Cases and checks.
3. Run `crux eval`; repeat runs do only the work invalidated by the change.
4. Inspect every Case, score, check, cost, latency, reuse reason, and linked
   production run in CLI or Devtools.
5. Accept a complete arm as the Baseline through CLI or Devtools.
6. Turn authenticated production feedback into Review work and deliberately
   add a correction as a source-controlled Case.

Every supported host must pass the same conformance suite. Offline and cost
preflight must finish before any partial execution. Persisted evidence must be
bounded, redacted, and attributable to the exact task, deployment, and source
identity that produced it.

## Next: change review

- Definition-centric health pages joining source, recent production runs,
  Eval coverage, Baseline compatibility, and lints.
- CI output that explains changed definitions, affected Evals, comparison
  results, and exact blockers in both JSON and readable summaries.
- Impact analysis over Project Index relations so a prompt, context, model,
  scorer, or policy edit selects only the required Eval work.
- Better decision-report coverage for routing, fallback, freshness, memory,
  retrieval, tool, and safety behavior.

## Later: governed learning data

Feedback and Review can support post-training only after consent, ownership,
redaction, retention, deletion, and provenance are enforceable end to end.
Production output never becomes expected truth or training data implicitly.
The first useful step is an explicit governed export of reviewed, eligible
records. Training execution remains provider-owned; Crux assembles evidence and
certifies a candidate against accepted Baselines.

## Non-goals

- Replacing provider SDKs or application frameworks.
- Requiring a hosted Crux control plane for local development.
- A second registry that repeats definitions already authored in code.
- Hidden inference, spend, credential lookup, or Baseline promotion.
- Claiming deterministic model output; Crux makes turn assembly and evidence
  deliberate, observable, and testable.
