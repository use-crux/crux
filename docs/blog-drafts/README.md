# Blog content plan

**The posts now live in the docs app: `apps/docs/content/blog/*.mdx`** — rendered at
`/blog` (list) and `/blog/<slug>` (detail) per the "Crux Blog" design from the Claude
Design project. The individual draft files that used to sit here were superseded by
the expanded MDX versions and removed. This file keeps the strategy context.

All 11 posts are published (`draft: false`) with fictive dates spread from
2026-06-02 to 2026-07-16, oldest = manifesto, matching the wave order. Future posts
can use `draft: true` to stay dev-only until ready.

## Strategy context (July 2026)

Keyword-verified plan. Key finding: "harness engineering" got real momentum in 2026
(Martin Fowler et al., mostly coding-agent framing) — the window to define it for
product AI harnesses is open but narrowing. Searchable posts target established terms
(context engineering, LLM observability, prompt testing, routing costs); shareable
posts carry the category story.

## Publish order

| Wave | Slugs | Notes |
| --- | --- | --- |
| Launch — time with public npm availability | `it-was-never-the-prompt` (featured), `what-did-the-model-see`, `vercel-ai-sdk-memory` | Manifesto + flagship walkthrough + exact-intent tutorial |
| Wave 2 | `context-engineering-missing-correctness`, `test-the-harness-not-just-the-output`, `silent-truncation`, `model-migration-without-regressions` | One deep piece every 2–3 weeks |
| Wave 3 | `rag-freshness-is-a-harness-problem`, `routing-policy-you-can-prove`, `guardrails-that-compose`, `where-a-harness-layer-fits` | Refresh migration post at major model releases |

## House rules (from GTM + vision docs)

- Every post: runnable code, a decision framework, limitations stated. No generic AI tips.
- Honest status labels always: Crux is alpha, Quality is beta, decision report / unified
  freshness / matcher library are in progress. Never imply deterministic model outputs.
- Non-combative toward the ecosystem (AI SDK, LangChain, Mastra, promptfoo, Mem0 et al.).
- Interlink posts, link each to its docs guide, and add published posts to llms.txt.

## Tone (benchmarked against Vercel/Next.js, AI SDK, Expo)

Aligned as of July 2026: short paragraphs (1–3 sentences), question-style headings on
tutorials, snippet-per-claim, honest experimental labels, docs CTA at close. Lengths
sit at ~1,100–1,400 words (7–9 min reads), matching the Next.js concept-post /
mid-range Expo band. Essays (`it-was-never-the-prompt`,
`context-engineering-missing-correctness`, `where-a-harness-layer-fits`) keep a more
essayistic voice on purpose — HN is their channel.
