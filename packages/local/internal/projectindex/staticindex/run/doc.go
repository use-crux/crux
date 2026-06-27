// Package run is the deep-module pipeline for a single Static Index execution.
//
// Run is the only entry point: it prepares the compiler plan, chooses between
// the native compile lane and the analyze/finalize lane, replays and writes the
// Static Index cache, and returns the resulting Project Index patch plus phase
// timing. Each concern lives in its own file so the facade stays small:
//
//   - prepare.go  - build the prepare request from the planned project.
//   - analyze.go  - select and load the source files to analyze.
//   - finalize.go - the analyze + finalize lane (extension evidence + finalize stream).
//   - compile.go  - the native compile lane (single compile stream).
//   - cache.go    - cache replay/write side effects.
//
// Callers depend on the Compiler interface, not the concrete Rust worker, so
// the pipeline can be driven by fakes in tests.
package run
