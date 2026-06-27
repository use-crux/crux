// Package staticindex is the Go bounded context for the source-only Project
// Index compiler lane (Static Index).
//
// It groups the collaborators that turn a planned project into a Project Index
// patch without a semantic type-checker:
//
//   - session  - high-level orchestration entry point for a project attempt.
//   - planner  - source discovery, classification, and plan construction.
//   - frontend - Rust/Oxc Static Syntax frontend process adapter (parser evidence).
//   - compiler - Go client for the Rust Static Index compiler methods.
//   - run      - the deep-module pipeline (prepare/analyze/finalize/compile/cache).
//   - protocol - the JSON contract mirror shared with the Rust worker.
//   - cache, compat, sourceprofile - cache replay/write, TypeScript evidence
//     bridging, and semantic source-profile handoff.
//
// Static Syntax means parser evidence; Static Index means the source-only
// Project Index compilation built from that evidence. Route and devtools code
// must reach this context through the projectindex service/readmodel APIs, not
// these packages directly.
package staticindex
