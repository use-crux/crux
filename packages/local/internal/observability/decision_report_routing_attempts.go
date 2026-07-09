package observability

import "fmt"

func routingAttemptDecision(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, index int, attemptIndex int, phase string, kind string, subjectKind string, failedCode string, succeededCode string, reason string, attempt routingAttemptDetail) TurnDecision {
	code := failedCode
	if attempt.Status == "ok" {
		code = succeededCode
	}
	decision := routingReceiptDecision(turn, span, artifact, index, phase, kind, subjectKind, routingAttemptOutcome(attemptIndex, attempt), observedReason(code, routingAttemptReasonText(reason, attempt)), routingAttemptMetrics(attempt))
	decision.ID = fmt.Sprintf("decision:%s:routing:%s:%d:%d", turn.SpanID, artifact.ArtifactID, index, attemptIndex)
	return decision
}

func routingAttemptReasonText(reason string, attempt routingAttemptDetail) string {
	if attempt.Error == "" {
		return reason
	}
	return boundedRoutingDecisionText(reason + ": " + attempt.Error)
}

func routingAttemptOutcome(index int, attempt routingAttemptDetail) string {
	status := firstNonEmpty(attempt.Status, "observed")
	model := firstNonEmpty(attempt.Model, "model")
	if attempt.ErrorCategory != "" {
		return fmt.Sprintf("attempt %d %s: %s", index+1, status, attempt.ErrorCategory)
	}
	return fmt.Sprintf("attempt %d %s: %s", index+1, status, model)
}

func routingAttemptMetrics(attempt routingAttemptDetail) *TurnDecisionMetrics {
	metrics := &TurnDecisionMetrics{DurationMs: attempt.DurationMs}
	if attempt.Cost != nil {
		metrics.CostUSD = *attempt.Cost
	}
	return metrics
}
