# Incremental Planner Before Partial Execution

`@crux/source-indexer` will introduce an incremental planner before adding partial AST or semantic execution. The planner consumes previous catalog source graph evidence, computes the affected closure when it can prove correctness, and otherwise returns an explicit full reindex fallback. This separates invalidation correctness from execution optimization, matching proven compiler and build-system designs and preventing incomplete dependency modeling from producing stale catalog snapshots.

**Considered Options**

- Build partial AST and semantic execution immediately.
- Keep always-full-reindex behavior until a complete dependency graph exists.
- Add a planner boundary now and wire partial execution later.

The planner-first option is the chosen trade-off because it creates a durable correctness boundary while keeping execution behavior conservative.
