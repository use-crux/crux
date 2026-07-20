package observability

import (
	"encoding/json"
	"strings"
)

func guardDecisionForSpan(turn SpanSummary, span SpanSummary, subjectKind string, tab string) TurnDecision {
	outcome := strings.ToLower(firstNonEmpty(stringAttribute(span.Attributes, "action"), span.Status, "unknown"))
	reasonCode := safetyReasonCode(subjectKind, outcome)
	decision := runtimeDecision(turn, span, "checks", span.Primitive, subjectKind, outcome, observedReason(reasonCode, subjectKind+" decision was observed."), tab)
	decision.Model = stringAttribute(span.Attributes, "model")
	decision.Location = mediaDecisionLocation(span.Attributes)
	decision.EscalatedToBlock = booleanAttribute(span.Attributes, "escalatedToBlock")
	return decision
}

func safetyReasonCode(subjectKind string, outcome string) string {
	passed := outcome == "ok" || outcome == "success" || outcome == "passed" || outcome == "allow" || outcome == "pass"
	blocked := outcome == "blocked" || outcome == "error" || outcome == "block" || outcome == "drop"
	switch subjectKind {
	case "guardrail":
		switch {
		case passed:
			return "guardrail.passed"
		case outcome == "warn" || outcome == "warning":
			return "guardrail.warned"
		case blocked:
			return "guardrail.blocked"
		case outcome == "rewrite" || outcome == "redact" || outcome == "transform":
			return "guardrail.redacted"
		case outcome == "strip":
			return "guardrail.stripped"
		}
	case "constraint":
		if passed {
			return "constraint.passed"
		}
		if outcome == "retry" {
			return "constraint.retry_requested"
		}
		if blocked {
			return "constraint.failed"
		}
	case "security":
		switch {
		case passed:
			return "security.passed"
		case outcome == "warn" || outcome == "warning":
			return "security.warned"
		case blocked:
			return "security.blocked"
		case outcome == "rewrite" || outcome == "redact" || outcome == "transform":
			return "security.redacted"
		}
	}
	return "custom.safety." + subjectKind + "." + outcome
}

func mediaDecisionLocation(attributes json.RawMessage) *TurnDecisionLocation {
	originKind := stringAttribute(attributes, "originKind")
	partType := stringAttribute(attributes, "mediaPartType")
	partIndex, ok := nonNegativeIntAttribute(attributes, "partIndex")
	if partType == "" || !ok {
		return nil
	}
	origin := TurnDecisionOrigin{Kind: originKind, PartIndex: partIndex}
	switch originKind {
	case "message":
		index, present := nonNegativeIntAttribute(attributes, "messageIndex")
		if !present {
			return nil
		}
		origin.MessageIndex = &index
	case "step":
		index, present := nonNegativeIntAttribute(attributes, "stepIndex")
		if !present {
			return nil
		}
		origin.StepIndex = &index
	case "operation":
		origin.Operation = stringAttribute(attributes, "operation")
		origin.Phase = stringAttribute(attributes, "operationPhase")
		origin.Field = stringAttribute(attributes, "field")
		if origin.Operation == "" || origin.Phase == "" || origin.Field == "" {
			return nil
		}
	default:
		return nil
	}
	return &TurnDecisionLocation{Origin: origin, PartType: partType}
}

func nonNegativeIntAttribute(attributes json.RawMessage, key string) (int, bool) {
	value, ok := numericAttribute(attributes, key)
	integer := int(value)
	return integer, ok && value >= 0 && float64(integer) == value
}
