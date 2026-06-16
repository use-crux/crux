# Crux Vision

## Mission

> Same Prompt. Same Output. Every Time.

The mission is **harness determinism**. Every input to a model turn — prompt, context, tools, memory, retrieval hits, model choice, safety policy, recovery path — should be deliberate, inspectable, and testable. When the harness is deterministic, the only variance left is the model itself, and even that variance can be measured, bounded, and routed.

Models are probabilistic. The harness around them does not have to be. Most production AI failures are not model failures; they are harness failures: the model saw the wrong context, a stale fact, an accidentally injected tool, an instruction silently dropped for budget, or a fallback nobody declared. Crux removes the accidents from the turn so behavior becomes reproducible, explainable, and improvable.

Explainability is not the mission; it is how the mission is reached. **You can't improve what you don't understand.** That is why observability and explanation are baked into every Crux primitive — not as a tracing feature, but as the feedback loop that lets you shape the harness until it is exactly right.

## What Crux Is

> Crux is the TypeScript toolkit for **harness engineering**: proactively design, measure, and shape everything around the model call until the same prompt gives the same output, on whichever model fits.

A harness is everything your application puts around the model call. Crux is not an agent runtime, not a provider abstraction, and not a tracing dashboard. Users bring their own SDK and their own models; Crux is the typed, observable, testable layer around that call. Use one block or ten — there is no framework to adopt and no platform to sign up for.

Crux's value has three layers, and the relationship between them is what makes it hard to copy.

### Layer 1: The Building Blocks

The primitives: typed prompts and contexts, memory blocks, retrieval and grounding, tools and approvals, guardrails and constraints, routing and fallback, plans and tasks, workspaces, compaction, orchestration patterns (pipeline, parallel, consensus, swarm, handoff, delegate), flows, and quality suites.

Each primitive is genuinely valuable on its own. Most of them do not exist in the SDKs users already have — there is no memory layer, no guardrail framework, no plan/task primitive, no harness-level eval system in a raw provider SDK. The building blocks fill those gaps and are the practical reason most users install Crux.

These blocks are not, by themselves, what sets Crux apart. Any single primitive can be copied by a framework or absorbed by an SDK. Their job is to be complete, composable, and excellent by default — and every primitive is held to the **explanation-parity bar**: a primitive is not done until its behavior is fully explained in the observability graph (its decisions, its reasons, its evidence), and a primitive does not gain new capability while its explanation is incomplete.

### Layer 2: One Way to Compose Them

Every primitive enters the turn the same way: composed into prompts and contexts through `use[]`. Memory, retrieval, guardrails, skills, blackboards, sub-contexts, and custom blocks all plug into the same composition model — nestable, conditional, prioritized, token-budgeted — and it just works.

One composition model is an architectural decision made on day one, and it is very hard to retrofit. A toolkit with many features and many different integration shapes can copy any Crux primitive; it cannot cheaply give those features a single, uniform way in.

That single composition model is also the long-term extension point. Its contract — how a block contributes to a turn and what evidence it must emit — is the future adapter contract: bring your own memory framework, workflow engine, or agent runtime, implement that contract, and your system rides the same graph, shows up in the same devtools, and is testable by the same matchers as the native primitives.

### Layer 3: One Graph, One Proof

Because everything enters the turn through one composition model, everything can be explained through one graph and tested through one harness. That property — one way in, one evidence graph, one proof system, tied to source — is the part of Crux competitors cannot easily reproduce. Copying any single layer does not reproduce it.

This layer is organized as the three questions a developer asks about any model turn:

1. **Before the turn — what will go into this turn, and why?** Which contexts, under which conditions, at which priority, within which budget. Which tools are eligible. Which model the router will pick. Which guardrails are armed. What the fallback and retry chain is. What memory will be recalled, and how fresh it all is. Crux's job: every one of those choices is deliberate and declared, never accidental.
2. **After the turn — what actually happened, and why?** The observability graph records each decision with its reason: which contexts got in, which were excluded or dropped and why, which model was actually selected and on what grounds, which guardrail fired and what it did, what fell back, what was retried, what memory was written and under which policy.
3. **Over time — can I prove it still behaves?** Quality suites assert the recorded decisions, not just the output text. Lint findings check the authored definitions. Changes to the harness are reviewable with evidence.

Every primitive passes through all three questions as an equal citizen. No primitive is the headline; the turn is the headline.

| Primitive | Goes in deliberately | Leaves evidence | Provable |
| --- | --- | --- | --- |
| Context | contracts, conditions, budget, freshness | included / excluded / dropped / stale, with reasons | "context X is included when mode is research" |
| Router | declared routing policy | which model was chosen, with rationale | "never downgrades below model X for task Y" |
| Guardrail | armed, with a declared boundary | fired / blocked / redacted, with reason | "blocks the injection regression cases" |
| Fallback | declared chain and retry policy | which fallback fired, caused by which error | "the chain engages in declared order" |
| Memory | recall policy, retention, redaction | reads and writes recorded with policy decisions | "the write was redacted before persisting" |

Two things make this hard to reproduce:

- **The Project Index.** Crux reads the authored AI system from source — prompts, contexts, tools, agents, flows, retrievers, memory, safety definitions, quality coverage — and joins it to runtime evidence. A runtime-only tool can show what happened; only a source-linked graph can show which authored definition caused it and which test protects it. This is the hardest part of Crux to copy, and the part that lives at design time.
- **Standard transport, owned semantics.** Capture is becoming a commodity: model-call spans are standardized through OpenTelemetry GenAI conventions, and Crux emits compatible spans so it slots into existing pipelines. What the standards have no vocabulary for is the turn-assembly layer: inclusion decisions, budget arbitration, freshness, routing rationale, policy boundaries, provenance to source. Crux owns that vocabulary — and intends to publish it as an open specification once it has stabilized in real usage, so that other runtimes can emit the same evidence and adapter authors have a contract to build against.

Honesty note: parts of this are built and parts are being completed. The composition model, the context primitives, and the canonical observability graph exist today. The full per-turn decision report, rationale artifacts for routing and consensus, the unified freshness vocabulary, and the harness-decision matcher library are in active development. The docs and roadmap mark shipped versus in-progress explicitly; the vision does not pretend otherwise.

## Proactive, Not Reactive

The dominant tooling pattern in AI engineering is reactive: run the system, collect traces, score the outputs, and guess backwards at what went wrong. Output scoring tells you *that* something failed; it cannot tell you *why*, because the tools doing the scoring did not assemble the turn. Teams compensate for a weak harness the only way they can — by paying for ever-stronger models to power through the noise.

Crux is proactive. It measures what goes *into* every turn, in detail, and how that behaves — and gives you the instruments to shape it until it is exactly right. The economics follow: a solid harness works with almost any capable model. That makes model choice a routing decision instead of a crutch — switch and route models per task and per subtask (and, in time, per step) to get exactly the capability you need, when you need it, at the price that fits. Routing is not a convenience feature in Crux; it is a first-order part of the determinism story.

## Test-Driven Harness Design

The proactive stance has a concrete workflow: build the harness the way disciplined teams build software.

1. Describe the expected cases first — inputs, expected context decisions, expected tool use, expected routing, expected safety behavior, expected output shape.
2. Program the harness against them until behavior matches the expectation exactly.
3. Mark that as a **baseline**.
4. Every change — prompt edit, context tweak, retriever swap, model upgrade, policy change — must meet at least that bar before it ships.

Crux's quality system (suites, targets, experiments, cassettes, baselines) exists to make this workflow native. The expectation exists before the harness does; that is what proactive means in practice.

## The Question Crux Answers

For any model turn:

- What did the model see?
- Where did each piece of context come from?
- Why was it included, excluded, dropped, cached, or refreshed?
- Was the context current enough for this task?
- Why was this model chosen for this turn, and what would have happened on failure?
- Did sensitive data enter the request, trace, memory, retrieval result, tool call, or provider boundary?
- Did the turn satisfy its output, safety, grounding, cost, latency, and quality expectations?
- Which authored definition or runtime decision should change?

## Positioning

### Bring Your SDK

Crux composes with the user's provider and SDK choices. When the underlying SDK can own execution, Crux passes through to it; Crux provides native execution only where a crucial harness pattern would otherwise be inaccessible, unobservable, or untestable. Crux will never be a provider abstraction — provider independence is a *consequence* of a good harness, not a product in itself.

### Entry Points, and the Flagship Demo

The building blocks give Crux many honest entry points: typed prompts for a team drowning in template strings; memory for an app whose SDK has none; guardrails that compose instead of wrapping; routing with a declared policy. Each entry point is real on its own — use 5% of Crux or 100%.

The flagship demo is the moment a visitor discovers the other two layers: wrap one existing SDK call with zero rewrite, open the devtools, and see the entire turn explained — what context got in and why, what was dropped for budget, which model the router picked and on what grounds, which guardrails were armed and which fired, what was stale, and what would have happened on failure. Visitors come for a primitive; they stay because everything they add composes the same way and shows up explained.

### Vocabulary

Three terms need one disambiguating line each:

- **Harness**: everything your application puts around the model call. Crux is the toolkit for building that layer — it is not an agent runtime or a coding-agent SDK.
- **Determinism**: deliberate, reproducible turn assembly — not a claim that models are deterministic.
- **Context engineering**: the established discipline of curating what the model sees. Crux treats it as one part of harness engineering, and adds what the discipline is missing: correctness — the ability to explain and test the curation itself.

### The Ecosystem

Crux is not trying to replace anyone, and the positioning should never be combative — the docs maintain factual compare pages and let the difference sell itself. The differences, stated plainly:

- Generation SDKs own the model call and increasingly the agent loop; Crux composes over them and explains the turn they execute.
- Tracing and observability platforms show the request after the fact; Crux is the layer that decided what went into the request — and can test that decision. A tool that did not assemble the turn cannot explain the assembly.
- Eval tools test what the model said; Crux also tests what the harness did.
- All-in-one agent frameworks bundle their own router and platform; Crux brings no runtime, no platform, and no lock-in.

One planning assumption, stated honestly: the ecosystem absorbs harness features quickly, and the unclaimed space — explained, source-linked, testable turn assembly — will narrow over the next one to two years. Crux's defenses are speed and depth: ship the explanation layer while it is unclaimed, and keep investing in the source-linked graph that runtime-only tools cannot retrofit.

## What Crux Should Not Become

Crux should avoid positioning itself primarily as:

- A generic agent framework.
- A RAG framework.
- A model router or provider abstraction.
- A hosted prompt-management platform.
- A tracing dashboard.
- A "LangChain but typed" toolkit.

Crux can include agents, retrieval, routing, prompt authoring, and devtools, but those serve the mission: deterministic, explained, tested model turns.

## The Horizon

This section is the long-term direction, not the near-term plan. The near-term plan is the core focus: explained, source-linked, tested turn assembly. The horizon explains what that focus is *for* — what becomes possible once a harness is deterministic and provable. None of it should pull attention from shipping the core, and none of it requires Crux to become an infrastructure company.

### The Thesis: The Model Commoditizes, The Harness Is The Asset

Open weights are closing the gap with frontier models, inference prices are falling, and "which model" is becoming a runtime decision rather than an architectural one. As that continues, the durable value in an AI product moves off the model and onto the harness: how the turn is assembled, governed, and proven. Crux is positioned exactly there. The long-term bet: the model becomes a swappable commodity, and the harness — versioned, baselined, certified — becomes the product.

### The Dataset Is The Asset

A deterministic, eval-scored harness produces something rare as a byproduct: a curated, evaluated dataset of (context, decision, output, quality verdict) records. That dataset is the bridge between the harness layer and the model layer, and it powers two delivery mechanisms from a single source:

- **Inject in context** — pass curated, dynamically-selected examples into the prompt. Works on any model, including closed ones you cannot tune. Mostly expressible in Crux today as a retriever over eval-passing examples.
- **Distill into weights** — bake the behavior into a smaller open model. Cheaper and faster per call, open models only.

The user picks the mechanism based on cost, latency, and privacy. Crux owns the dataset and — critically — the same baseline suite certifies either path is good enough. This is "Same Prompt. Same Output. Every Time." pushed all the way down to the model layer: you choose how to get there — context injection, distillation, or routing — and the same bar proves it.

### Own The Ends, Rent The Middle

The compute step of fine-tuning is already a commodity: upload pairs, pick a base model, get a tuned model back from a training provider. The genuinely hard parts are the two ends — assembling good, quality-filtered data, and certifying the result did not regress. Crux already owns both: the graph and cassettes are the data end; the baselines are the eval end. So Crux's role in training mirrors its role in inference — **bring your SDK** for inference becomes **bring your training provider** for tuning. Crux assembles and certifies; it delegates execution. Crux owns no GPUs and hosts no weights; that is consistent with, not contrary to, the non-goals above.

### Make The Complex Thing Dead-Simple

The strategic opportunity is accessibility. Distilling a certified, specialized model from your own traffic is today a months-long MLOps project that only well-resourced teams attempt. Because Crux already holds the two hard ends, it can wire the easy middle to a provider such as Fireworks and collapse the whole pipeline to a button: assemble the dataset, fire the training job, run the baselines against the result, hand back a certified model to download or serve. The mission — making reliable AI accessible to teams that are not AI-infrastructure companies — extends naturally to making model specialization accessible too.

### The Steps, In Order

Each step is independently valuable. Take the next one only when the step below it has real users.

1. **In-context specialization** — inject curated examples; works on any model. Near-term; mostly expressible today.
2. **Export a governed dataset** — clean, redaction-aware, eligibility-gated (context, output, verdict) records. The one decision worth making now, because it keeps every later step open.
3. **One-shot distill and certify** — push a button: assemble, delegate the training run, gate on baselines, download the model.
4. **Managed, live auto-tune** — continuously retrain as new eligible data arrives, and **promote new weights only when they pass the baseline suite** (the baseline is the airbag that makes auto-tuning safe). Data-deletion requests are honored by exclude-and-retrain at the next cycle — surgical unlearning is unsolved, but a continuous-retrain architecture makes deletion compliant by design. Optional hosting through a provider passthrough.

The far edge of step 4: very small models post-trained for a single use case — even a single customer — to get an extremely fast, cheap, private model. That becomes worthwhile only when provider training and hosting are cheap enough, which is a question of market timing, not of Crux architecture.

### Governance Is The Enabler Here, Too

Turning interactions and memory into training data is a serious privacy and consent surface. The eligibility gate — "this memory is personal, it never enters a dataset" — must be enforceable from day one, not bolted on. Done right, data lineage from interaction to dataset to weights is a genuine differentiator and the foundation of deletion compliance. This is privacy-as-a-graph-property earning its keep.

### The Discipline

All of the above is long-horizon. The only action it implies now is step 2: keep cassettes and traces designed as clean, governed, exportable records. That single contract keeps every later step open while Crux stays focused on the core. Everything else is "design the seams, build when there are users."

## Product Principles

### 1. The Mission Leads

Every feature should make the harness more deterministic, explainable, testable, or improvable. If a feature does not serve "Same Prompt. Same Output. Every Time.", it is not core.

### 2. Bring Your SDK

Crux composes with the user's provider and SDK choices. It does not force a runtime, a hosted platform, or an agent framework.

### 3. One Composition Model Is the Architecture

Everything composes through `use[]`. New primitives must go through that same model; nothing integrates through a side channel. That composition contract is the future adapter contract.

### 4. The Building Blocks Are Complete, but Not the Point

Native primitives prove the patterns, provide great defaults, and give devtools first-class insight. They are reference implementations, not lock-in: stable contracts must eventually let external memory, workflow, agent, and retrieval systems participate in the same graph. What sets Crux apart is not the blocks themselves but that everything they do is explained and tested through one graph.

### 5. Code Is Config, But Behavior Is Explicit

Users configure the harness by constructing and wiring primitives in code. If a prompt uses a memory, and that memory was constructed with a store, Crux should infer the relationship from code and runtime evidence. Local tools should not require users to repeat that wiring in `config({ prompts, stores, memories })`.

Crux should not make ownership decisions magically. Stores, providers, telemetry, cloud upload, training export, retention, and sensitive data boundaries require explicit user choices. The principle is: explicit construction decides behavior; Crux discovery provides visibility.

### 6. The Model Turn Is the Unit of Truth

Every feature should help explain or improve a real model turn: its context, tools, memory, retrieval, routing, safety, cost, quality, and output.

### 7. Every Decision Is Inspectable

If Crux includes, excludes, drops, caches, refreshes, redacts, blocks, routes, retries, or falls back, that decision is visible in inspection, in the graph, and in quality results — with its reason, not just its outcome.

### 8. The Explanation-Parity Bar

A primitive is complete only when it answers all three questions: declared deliberately, evidenced with reasons, assertable in quality suites. A primitive whose explanation is incomplete does not gain new capability.

### 9. Deterministic Assembly Is a Ship Condition

Any feature that introduces nondeterminism into turn assembly must be deterministic-policy-first, replayable, and assertable by quality suites — or it does not ship. This applies in particular to any future planning or model-assisted context selection.

### 10. Coherence Before New Primitives

Crux already has many powerful pieces. The next advantage comes from connecting them into one explained, tested workflow — not from adding more disconnected capabilities.

### 11. Privacy Is a Graph Property

Sensitive data moves through retrieval hits, memory writes, tool args, workspace files, feedback records, traces, cassettes, and telemetry. Crux treats privacy as data flow through the harness — classification on evidence, policies at boundaries, lints and matchers as proof — not as a one-off guardrail.

### 12. Honest Status, Always

Documentation never presents scaffolding as shipped. Shipped, in-progress, and planned are labeled as such.

## North Star Experience

A team opens Crux devtools after a bad AI response.

Crux shows:

- The exact request sent to the provider.
- Each context block, memory recall, retrieval hit, tool result, and policy instruction.
- Why each was included, and whether anything was excluded or dropped.
- Freshness state for the context that mattered.
- Which model was selected, why, and what the fallback would have been.
- Safety and privacy decisions, including redactions and blocked boundaries.
- The quality baselines covering this prompt, and whether this turn would have passed them.
- The source definitions and lint findings that explain the underlying design issue.
- A suggested fix: tighten a condition, add a freshness policy, add a matcher, adjust routing policy, add a guardrail, or change a memory write policy.

Then the team adds the missing expectation to a suite, fixes the harness until it passes, and marks the new baseline. Next time, the regression is caught before it ships.

## Success Metrics

Crux is succeeding if users can:

- Debug a bad AI turn without reading raw logs.
- Identify missing, stale, unsafe, or redundant context quickly.
- See why every routing, safety, memory, and recovery decision was made.
- Describe expected harness behavior first, and build against it until green.
- Review AI-system changes in source with quality evidence and baselines.
- Run cheaper or better-fitting models because the harness, not the model, carries the system.
- Keep sensitive data out of the wrong prompts, tools, stores, traces, and telemetry.

## Working Taglines

- Same Prompt. Same Output. Every Time.
- It was never the prompt. It was the harness.
- Know what the model saw, why it saw it, and whether it worked.
- Test the harness, not just the output.
- Proactive, not reactive.
- Stop paying model prices for harness problems.
