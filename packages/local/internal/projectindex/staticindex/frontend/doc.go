// Package frontend is the Go process adapter for the Static Syntax frontend.
//
// It supervises the Rust/Oxc parser worker process and exposes Static Syntax
// evidence (parser records emitted before Project Index fact projection) to the
// rest of the Static Index lane. The package owns worker process lifecycle,
// pooling, and the raw NDJSON envelope; record shaping and stream decoding live
// in the record and stream subpackages.
//
// "Frontend" names the implementation-specific parser frontend (Oxc today).
// This package deliberately replaces the older "syntax" package name, which
// conflated parser evidence with the worker process it supervises.
package frontend
