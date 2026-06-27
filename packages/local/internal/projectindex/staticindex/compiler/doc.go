// Package compiler is the Go client for the Rust Static Index compiler methods.
//
// It is a thin typed boundary over the frontend worker process that exposes the
// prepare, analyze, finalize, and compile protocol calls used by the run
// pipeline. Keeping it separate from the frontend parser adapter lets callers
// prove the compiler lane drives native compilation only and never reaches into
// Node projection or TypeScript syntax-record bridges.
//
// This package deliberately replaces the older "client" package name so the Go
// name matches the Static Index compiler concept used across TypeScript, Go,
// and Rust.
package compiler
