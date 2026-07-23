package server

import "github.com/use-crux/crux/packages/local/internal/lsp/readmodel"

type completionOutcomeKind uint8

const (
	// completionOutcomeSoft is an expected fail-soft result and carries no
	// worker-health signal.
	completionOutcomeSoft completionOutcomeKind = iota
	// completionOutcomeCurrent is a coherent successful result, including an
	// empty result for unsupported syntax or a refused unsafe edit.
	completionOutcomeCurrent
	// completionOutcomeWorkerFailure is a genuine compiler or transport error.
	completionOutcomeWorkerFailure
	// completionOutcomeWorkerFailureThreshold means the owning scope has
	// reached at least three consecutive genuine failures.
	completionOutcomeWorkerFailureThreshold
)

type completionOutcomeReason string

const (
	completionReasonUntrusted            completionOutcomeReason = "untrusted"
	completionReasonBufferUnavailable    completionOutcomeReason = "buffer_unavailable"
	completionReasonWorkspaceUnavailable completionOutcomeReason = "workspace_unavailable"
	completionReasonInvalidURI           completionOutcomeReason = "invalid_uri"
	completionReasonScopeUnavailable     completionOutcomeReason = "scope_unavailable"
	completionReasonSourceUnavailable    completionOutcomeReason = "source_unavailable"
	completionReasonCanceled             completionOutcomeReason = "canceled"
	completionReasonTimeout              completionOutcomeReason = "timeout"
	completionReasonStaleSource          completionOutcomeReason = "stale_source"
	completionReasonStaleDocument        completionOutcomeReason = "stale_document"
	completionReasonStaleGeneration      completionOutcomeReason = "stale_generation"
	completionReasonWorkerFailure        completionOutcomeReason = "worker_failure"
	completionReasonEmpty                completionOutcomeReason = "empty"
	completionReasonItems                completionOutcomeReason = "items"
)

// completionOutcome crosses the workspace/server boundary with bounded
// classification only. It must never retain compiler errors, source text, or
// source paths.
type completionOutcome struct {
	Kind   completionOutcomeKind
	Reason completionOutcomeReason
	Result readmodel.CompletionResult
}
