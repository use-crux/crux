// Package workerproc manages JSON-lines worker subprocesses for the local
// runtime.
//
// It owns process lifetime, request framing, stream collection, cancellation,
// and shutdown. Higher-level Project Index, Static Index, and devtools
// packages should pass data-only requests into this package rather than
// embedding worker process details in their own orchestration code.
package workerproc
