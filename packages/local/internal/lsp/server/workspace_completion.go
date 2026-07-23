package server

import (
	"context"
	"errors"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

const completionDeadline = 250 * time.Millisecond

type completionWorkspace interface {
	Completion(context.Context, protocol.DocumentURI, readmodel.CompletionRequest) completionOutcome
}

// Completion pins one OWN or ATTACHED source epoch and rejects any result
// whose document, mode/source, or index generation advanced.
func (w *workspaceRuntime) Completion(
	ctx context.Context,
	uri protocol.DocumentURI,
	request readmodel.CompletionRequest,
) completionOutcome {
	session := w.navigationSession(uri)
	if session == nil {
		return completionOutcome{
			Kind: completionOutcomeSoft, Reason: completionReasonScopeUnavailable,
		}
	}
	w.mu.Lock()
	if w.closed || (session.mode != readmodel.ModeOwn && session.mode != readmodel.ModeAttached) || session.completion == nil {
		w.mu.Unlock()
		return completionOutcome{
			Kind: completionOutcomeSoft, Reason: completionReasonSourceUnavailable,
		}
	}
	source := session.completion
	epoch := session.sourceEpoch
	scope := session.scope.ID
	w.mu.Unlock()

	queryContext, cancel := context.WithTimeout(ctx, completionDeadline)
	defer cancel()
	result, err := source.Completion(queryContext, request)
	publication := w.store.PublicationSnapshot(scope)
	w.mu.Lock()
	current := !w.closed && (session.mode == readmodel.ModeOwn || session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == epoch
	if err != nil {
		reason := completionErrorReason(current, queryContext.Err(), err)
		if reason != completionReasonWorkerFailure {
			w.mu.Unlock()
			return completionOutcome{Kind: completionOutcomeSoft, Reason: reason}
		}
		session.completionFailures++
		kind := completionOutcomeWorkerFailure
		if session.completionFailures >= 3 {
			kind = completionOutcomeWorkerFailureThreshold
		}
		w.mu.Unlock()
		return completionOutcome{Kind: kind, Reason: completionReasonWorkerFailure}
	}
	if !current {
		w.mu.Unlock()
		return completionOutcome{
			Kind: completionOutcomeSoft, Reason: completionReasonStaleSource,
		}
	}
	if queryContext.Err() != nil {
		reason := completionReasonCanceled
		if errors.Is(queryContext.Err(), context.DeadlineExceeded) {
			reason = completionReasonTimeout
		}
		w.mu.Unlock()
		return completionOutcome{Kind: completionOutcomeSoft, Reason: reason}
	}
	if result.DocumentVersion != request.DocumentVersion {
		w.mu.Unlock()
		return completionOutcome{
			Kind: completionOutcomeSoft, Reason: completionReasonStaleDocument,
		}
	}
	if !publication.GenerationKnown || publication.Generation != result.Generation {
		if publication.GenerationKnown && publication.Generation != result.Generation {
			session.completionFailures = 0
		}
		w.mu.Unlock()
		return completionOutcome{
			Kind: completionOutcomeSoft, Reason: completionReasonStaleGeneration,
		}
	}
	session.completionFailures = 0
	w.mu.Unlock()
	reason := completionReasonItems
	if len(result.Items) == 0 {
		reason = completionReasonEmpty
	}
	return completionOutcome{
		Kind: completionOutcomeCurrent, Reason: reason, Result: result,
	}
}

func (w *workspaceRuntime) resetCompletionFailures(session *scopeSession) {
	w.mu.Lock()
	session.completionFailures = 0
	w.mu.Unlock()
}

func completionErrorReason(
	current bool,
	contextError error,
	queryError error,
) completionOutcomeReason {
	if !current {
		return completionReasonStaleSource
	}
	if errors.Is(contextError, context.DeadlineExceeded) ||
		errors.Is(queryError, context.DeadlineExceeded) {
		return completionReasonTimeout
	}
	if errors.Is(contextError, context.Canceled) ||
		errors.Is(queryError, context.Canceled) {
		return completionReasonCanceled
	}
	if errors.Is(queryError, readmodel.ErrCompletionUnavailable) {
		return completionReasonSourceUnavailable
	}
	return completionReasonWorkerFailure
}
