package observability

import (
	"encoding/json"
	"fmt"
)

type routingReceiptPreview struct {
	Kind  string            `json:"kind"`
	Model string            `json:"model"`
	Cost  *float64          `json:"cost"`
	Trace []json.RawMessage `json:"trace"`
}

type routingStepHeader struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type routingRouterStep struct {
	routingStepHeader
	ClassifiedAs     string `json:"classifiedAs"`
	Route            string `json:"route"`
	UsedDefaultRoute bool   `json:"usedDefaultRoute"`
	Forced           bool   `json:"forced"`
}

type routingSplitStep struct {
	routingStepHeader
	Route string `json:"route"`
	Seed  string `json:"seed"`
}

type routingRetryStep struct {
	routingStepHeader
	Model    string                 `json:"model"`
	Attempts []routingAttemptDetail `json:"attempts"`
}

type routingFallbackStep struct {
	routingStepHeader
	Attempts         []routingAttemptDetail `json:"attempts"`
	MidStreamFailure bool                   `json:"midStreamFailure"`
}

type routingCascadeStep struct {
	routingStepHeader
	Tiers          []routingTierDetail `json:"tiers"`
	AcceptedAtTier int                 `json:"acceptedAtTier"`
	BudgetExceeded bool                `json:"budgetExceeded"`
}

type routingAttemptDetail struct {
	Model         string   `json:"model"`
	Status        string   `json:"status"`
	DurationMs    float64  `json:"durationMs"`
	Cost          *float64 `json:"cost"`
	ErrorCategory string   `json:"errorCategory"`
	Error         string   `json:"error"`
	DelayMs       *float64 `json:"delayMs"`
}

type routingTierDetail struct {
	Model      string   `json:"model"`
	Status     string   `json:"status"`
	DurationMs float64  `json:"durationMs"`
	Cost       *float64 `json:"cost"`
	JudgeCost  *float64 `json:"judgeCost"`
	Confidence *float64 `json:"confidence"`
	Budget     *float64 `json:"budget"`
	Note       string   `json:"note"`
}

func routingReceiptDecisionsForDetail(turn SpanSummary, detail RunDetailDetail) ([]TurnDecision, []TurnDecisionChip, bool) {
	for _, artifact := range detail.Artifacts {
		if artifact.Kind != "routing.report" {
			continue
		}
		decisions, chips, ok := routingReceiptDecisions(turn, detail.SpanSummary, artifact)
		if ok {
			return decisions, chips, true
		}
	}
	return nil, nil, false
}

func routingReceiptDecisionsForNode(turn SpanSummary, node RunDetailNode) ([]TurnDecision, []TurnDecisionChip, bool) {
	for _, artifact := range node.Artifacts {
		if artifact.Kind != "routing.report" {
			continue
		}
		decisions, chips, ok := routingReceiptDecisions(turn, node.SpanSummary, artifact)
		if ok {
			return decisions, chips, true
		}
	}
	return nil, nil, false
}

func routingReceiptDecisions(turn SpanSummary, span SpanSummary, artifact ArtifactSummary) ([]TurnDecision, []TurnDecisionChip, bool) {
	var receipt routingReceiptPreview
	if len(artifact.Preview) == 0 || json.Unmarshal(artifact.Preview, &receipt) != nil || receipt.Kind != "routing.report" || len(receipt.Trace) == 0 {
		return nil, nil, false
	}
	decisions := make([]TurnDecision, 0, len(receipt.Trace))
	var chips []TurnDecisionChip
	for index, raw := range receipt.Trace {
		stepDecisions, stepChips, ok := routingStepDecisions(turn, span, artifact, raw, index)
		if !ok {
			continue
		}
		decisions = append(decisions, stepDecisions...)
		chips = appendRoutingDecisionChips(chips, stepChips...)
	}
	return decisions, chips, len(decisions) > 0
}

func routingStepDecisions(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, raw json.RawMessage, index int) ([]TurnDecision, []TurnDecisionChip, bool) {
	var header routingStepHeader
	if json.Unmarshal(raw, &header) != nil || header.Kind == "" {
		return nil, nil, false
	}
	switch header.Kind {
	case "router":
		var step routingRouterStep
		if json.Unmarshal(raw, &step) != nil {
			return nil, nil, false
		}
		return []TurnDecision{routerStepDecision(turn, span, artifact, step, index)}, routerStepChips(step), true
	case "split":
		var step routingSplitStep
		if json.Unmarshal(raw, &step) != nil {
			return nil, nil, false
		}
		return []TurnDecision{splitStepDecision(turn, span, artifact, step, index)}, nil, true
	case "retry":
		var step routingRetryStep
		if json.Unmarshal(raw, &step) != nil {
			return nil, nil, false
		}
		return retryStepDecisions(turn, span, artifact, step, index), nil, len(step.Attempts) > 0
	case "fallback":
		var step routingFallbackStep
		if json.Unmarshal(raw, &step) != nil {
			return nil, nil, false
		}
		return fallbackStepDecisions(turn, span, artifact, step, index), fallbackStepChips(step), len(step.Attempts) > 0
	case "cascade":
		var step routingCascadeStep
		if json.Unmarshal(raw, &step) != nil {
			return nil, nil, false
		}
		return []TurnDecision{cascadeStepDecision(turn, span, artifact, step, index)}, cascadeStepChips(step), true
	default:
		return nil, nil, false
	}
}

func routerStepDecision(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, step routingRouterStep, index int) TurnDecision {
	code := "routing.router.selected"
	if step.Forced {
		code = "routing.router.forced_route"
	} else if step.UsedDefaultRoute {
		code = "routing.router.default_route"
	}
	label := firstNonEmpty(step.Route, step.ClassifiedAs, "route")
	return routingReceiptDecision(turn, span, artifact, index, "model-selection", "routing.router", "route", label, observedReason(code, "Router selected a route."), nil)
}

func splitStepDecision(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, step routingSplitStep, index int) TurnDecision {
	label := firstNonEmpty(step.Route, "bucket")
	return routingReceiptDecision(turn, span, artifact, index, "model-selection", "routing.split", "route", label, observedReason("routing.split.selected", "Split selected a bucket."), nil)
}

func retryStepDecisions(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, step routingRetryStep, index int) []TurnDecision {
	decisions := make([]TurnDecision, 0, len(step.Attempts))
	for attemptIndex, attempt := range step.Attempts {
		decisions = append(decisions, routingAttemptDecision(turn, span, artifact, index, attemptIndex, "recovery", "routing.retry", "retry", "routing.retry.attempt_failed", "routing.retry.attempt_succeeded", "Retry attempt was observed.", attempt))
	}
	return decisions
}

func fallbackStepDecisions(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, step routingFallbackStep, index int) []TurnDecision {
	decisions := make([]TurnDecision, 0, len(step.Attempts))
	for attemptIndex, attempt := range step.Attempts {
		decisions = append(decisions, routingAttemptDecision(turn, span, artifact, index, attemptIndex, "recovery", "routing.fallback", "route", "routing.fallback.attempt_failed", "routing.fallback.attempt_succeeded", "Fallback attempt was observed.", attempt))
	}
	return decisions
}

func cascadeStepDecision(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, step routingCascadeStep, index int) TurnDecision {
	code := "routing.cascade.tier_accepted"
	if step.BudgetExceeded {
		code = "routing.cascade.budget_exceeded"
	}
	outcome := fmt.Sprintf("accepted tier %d", step.AcceptedAtTier+1)
	return routingReceiptDecision(turn, span, artifact, index, "model-selection", "routing.cascade", "route", outcome, observedReason(code, "Cascade tier decision was observed."), cascadeMetrics(step))
}

func routingReceiptDecision(turn SpanSummary, span SpanSummary, artifact ArtifactSummary, index int, phase string, kind string, subjectKind string, outcome string, reason TurnDecisionReason, metrics *TurnDecisionMetrics) TurnDecision {
	if metrics == nil {
		metrics = &TurnDecisionMetrics{DurationMs: span.DurationMs}
	}
	return TurnDecision{
		ID:      fmt.Sprintf("decision:%s:routing:%s:%d", turn.SpanID, artifact.ArtifactID, index),
		Phase:   phase,
		Kind:    kind,
		Subject: TurnDecisionSubject{Kind: subjectKind, ID: firstNonEmpty(artifact.ArtifactID, span.SpanID), Name: firstNonEmpty(span.Name, kind)},
		Outcome: firstNonEmpty(outcome, "observed"),
		Reason:  reason,
		Source:  ptrSourceJoin(runtimeSourceJoin(span)),
		Tab:     &TurnDeepTabTarget{Tab: "Routing", SpanID: span.SpanID, ArtifactID: artifact.ArtifactID},
		Evidence: []TurnEvidenceRef{
			{Kind: "span", SpanID: span.SpanID, Primitive: span.Primitive, Role: "routing-receipt"},
			{Kind: "artifact", SpanID: span.SpanID, ArtifactID: artifact.ArtifactID, ArtifactKind: artifact.Kind, Role: "routing-receipt"},
		},
		Metrics: metrics,
	}
}

func routerStepChips(step routingRouterStep) []TurnDecisionChip {
	if !step.UsedDefaultRoute {
		return nil
	}
	return []TurnDecisionChip{{ID: "routing.default_route", Label: "default route", Tone: "warn", Filter: &TurnDecisionChipFilter{Target: "decisions", Value: "routing.router.default_route"}}}
}

func fallbackStepChips(step routingFallbackStep) []TurnDecisionChip {
	if !step.MidStreamFailure {
		return nil
	}
	return []TurnDecisionChip{{ID: "routing.mid_stream_failure", Label: "mid-stream failure", Tone: "warn", Filter: &TurnDecisionChipFilter{Target: "decisions", Value: "routing.fallback"}}}
}

func cascadeStepChips(step routingCascadeStep) []TurnDecisionChip {
	if !step.BudgetExceeded {
		return nil
	}
	return []TurnDecisionChip{{ID: "routing.budget_exceeded", Label: "budget exceeded", Tone: "warn", Filter: &TurnDecisionChipFilter{Target: "decisions", Value: "routing.cascade.budget_exceeded"}}}
}

func appendRoutingDecisionChips(chips []TurnDecisionChip, next ...TurnDecisionChip) []TurnDecisionChip {
	for _, chip := range next {
		seen := false
		for _, existing := range chips {
			if existing.ID == chip.ID {
				seen = true
				break
			}
		}
		if !seen {
			chips = append(chips, chip)
		}
	}
	return chips
}

func cascadeMetrics(step routingCascadeStep) *TurnDecisionMetrics {
	metrics := &TurnDecisionMetrics{}
	for _, tier := range step.Tiers {
		metrics.DurationMs += tier.DurationMs
		if tier.Cost != nil {
			metrics.CostUSD += *tier.Cost
		}
		if tier.JudgeCost != nil {
			metrics.CostUSD += *tier.JudgeCost
		}
		if tier.Status == "accepted" && tier.Confidence != nil {
			metrics.Confidence = *tier.Confidence
		}
	}
	return metrics
}
