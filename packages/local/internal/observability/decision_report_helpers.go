package observability

import (
	"encoding/json"
	"strconv"
	"strings"
)

func declaredReason(code string, text string) TurnDecisionReason {
	return TurnDecisionReason{
		Code:          code,
		Text:          firstNonEmpty(text, code),
		EvidenceLevel: "declared",
		Source:        "artifact",
	}
}

func missingReason(code string, text string) TurnDecisionReason {
	return TurnDecisionReason{
		Code:          code,
		Text:          firstNonEmpty(text, code),
		EvidenceLevel: "missing",
		Source:        "not-recorded",
	}
}

func contributionName(contribution RunDetailRequestContribution) string {
	return firstNonEmpty(contribution.SourceID, contribution.InjectableKind, contribution.Kind)
}

func contextTab(contribution RunDetailRequestContribution) *TurnDeepTabTarget {
	return &TurnDeepTabTarget{
		Tab:        "Context",
		AnchorID:   contribution.SourceID,
		ArtifactID: contribution.ArtifactID,
		SpanID:     contribution.SourceSpanID,
	}
}

func evidenceForContribution(contribution RunDetailRequestContribution) []TurnEvidenceRef {
	if contribution.ArtifactID == "" {
		return nil
	}
	return []TurnEvidenceRef{{
		Kind:         "artifact",
		ArtifactID:   contribution.ArtifactID,
		ArtifactKind: "context.contribution",
		SpanID:       contribution.SourceSpanID,
		Role:         "context-disposition",
	}}
}

func metricsForContribution(contribution RunDetailRequestContribution) *TurnDecisionMetrics {
	metrics := &TurnDecisionMetrics{
		Tokens:        floatPtrValue(contribution.Tokens),
		StaticTokens:  floatPtrValue(contribution.StaticTokens),
		DynamicTokens: floatPtrValue(contribution.DynamicTokens),
		Priority:      floatPtrValue(contribution.Priority),
		SizeBytes:     floatPtrValue(contribution.SizeBytes),
	}
	if *metrics == (TurnDecisionMetrics{}) {
		return nil
	}
	return metrics
}

func cacheEvidenceForContribution(contribution RunDetailRequestContribution, freshness *TurnFreshnessEvidence) *TurnCacheEvidence {
	status := normalizeCacheStatus(contribution.CacheStatus)
	if status == "" || status == "disabled" || status == "not-applicable" {
		return nil
	}
	return &TurnCacheEvidence{
		Subject:             TurnDecisionSubject{Kind: firstNonEmpty(contribution.InjectableKind, "context"), ID: contribution.SourceID, Name: contributionName(contribution)},
		Status:              status,
		CacheKey:            contribution.CacheKey,
		AgeMs:               floatPtrValue(contribution.CacheAgeMs),
		TTLMS:               floatPtrValue(contribution.CacheTTLMS),
		AcceptedByFreshness: cacheAcceptedByFreshness(freshness),
		RejectedByFreshness: cacheRejectedByFreshness(freshness),
		Reason:              firstNonEmpty(contribution.CacheReason, contribution.CacheStatus, status),
		EvidenceLevel:       "declared",
		Tab:                 contextTab(contribution),
	}
}

func cacheDecisionForContribution(span SpanSummary, contribution RunDetailRequestContribution, cache TurnCacheEvidence) TurnDecision {
	return TurnDecision{
		ID:      "decision:" + span.SpanID + ":cache:" + firstNonEmpty(contribution.SourceID, contribution.ArtifactID, "context"),
		Phase:   "efficiency",
		Kind:    "context.cache",
		Subject: cache.Subject,
		Outcome: cache.Status,
		Reason:  declaredReason(cacheFreshnessReasonCode(cache), "Context cache status was evaluated with freshness evidence."),
		Source:  ptrSourceJoin(sourceJoinForContribution(contribution)),
		Tab:     contextTab(contribution),
		Cache:   &cache,
	}
}

func sawToolItem(span SpanSummary, tool RunDetailRequestTool) TurnSawItem {
	sourceStatus := "used"
	return TurnSawItem{
		Kind:          "tool",
		Name:          tool.Name,
		ID:            tool.Name,
		Disposition:   "active",
		EvidenceLevel: "declared",
		SourceStatus:  sourceStatus,
		Tab:           &TurnDeepTabTarget{Tab: "Context", AnchorID: tool.Name, SpanID: span.SpanID},
	}
}

func toolDecision(span SpanSummary, tool RunDetailRequestTool) TurnDecision {
	code := "tool.eligible.request"
	if tool.Origin == "injected" {
		code = "tool.eligible.context_injection"
	}
	return TurnDecision{
		ID:      "decision:" + span.SpanID + ":tool:" + tool.Name,
		Phase:   "tool-use",
		Kind:    "tool.eligible",
		Subject: TurnDecisionSubject{Kind: "tool", ID: tool.Name, Name: tool.Name},
		Outcome: "active",
		Reason:  declaredReason(code, "Tool was eligible for the request."),
		Tab:     &TurnDeepTabTarget{Tab: "Context", AnchorID: tool.Name, SpanID: span.SpanID},
	}
}

func sourceGroups(prompt TurnSourceJoin, contexts []TurnSourceJoin) []TurnSourceGroup {
	groups := []TurnSourceGroup{}
	if prompt.ID != "" || prompt.Name != "" {
		groups = append(groups, TurnSourceGroup{Group: "Prompt", Items: []TurnSourceJoin{prompt}})
	}
	if len(contexts) > 0 {
		groups = append(groups, TurnSourceGroup{Group: "Contexts", Items: contexts})
	}
	return groups
}

func sourceStatusForDisposition(disposition string) string {
	switch disposition {
	case "active":
		return "used"
	case "dropped":
		return "dropped"
	case "checked", "disabled":
		return "checked"
	default:
		return "unknown"
	}
}

func fidelityForSourceID(sourceID string) string {
	if sourceID == "" {
		return "unresolved"
	}
	return "source-id"
}

func unresolvedReasonForSourceID(sourceID string) string {
	if sourceID == "" {
		return "missing-runtime-join"
	}
	return ""
}

func ptrSourceJoin(source TurnSourceJoin) *TurnSourceJoin {
	return &source
}

func normalizeCacheStatus(status string) string {
	switch strings.ToLower(status) {
	case "hit", "miss", "write", "disabled", "mixed", "unknown", "not-applicable":
		return strings.ToLower(status)
	case "":
		return ""
	default:
		return "unknown"
	}
}

func defaultTurnDecisionCoverage() TurnDecisionCoverage {
	areas := []TurnCoverageArea{
		{Area: "Output quality", Status: "unknown", Suggest: "Assert output quality for this turn", EvidenceLevel: "missing"},
		{Area: "Context inclusion", Status: "unknown", Suggest: "Assert required contexts are included", EvidenceLevel: "missing"},
		{Area: "Routing/fallback", Status: "unknown", Suggest: "Assert routing and fallback outcomes", EvidenceLevel: "missing"},
		{Area: "Freshness/cache acceptance", Status: "unknown", Suggest: "Assert freshness and cache acceptance", EvidenceLevel: "missing"},
		{Area: "Guardrail/security", Status: "unknown", Suggest: "Assert guardrail and security outcomes", EvidenceLevel: "missing"},
		{Area: "Tool use", Status: "unknown", Suggest: "Assert eligible and called tools", EvidenceLevel: "missing"},
	}
	return TurnDecisionCoverage{Total: len(areas), Areas: areas}
}

func missingRequestGap(span SpanSummary) TurnDecisionDiagnostic {
	subject := TurnDecisionSubject{Kind: "generation", ID: span.SpanID, Name: span.Name}
	return TurnDecisionDiagnostic{
		Code:          "request.not-recorded",
		Text:          "Request composition evidence was not recorded for this turn.",
		EvidenceLevel: "missing",
		Subject:       &subject,
	}
}

func missingFreshnessGap(span SpanSummary) TurnDecisionDiagnostic {
	subject := TurnDecisionSubject{Kind: "generation", ID: span.SpanID, Name: span.Name}
	return TurnDecisionDiagnostic{
		Code:          "freshness.not-recorded",
		Text:          "Freshness evidence was not recorded for this turn.",
		EvidenceLevel: "missing",
		Subject:       &subject,
	}
}

func turnVerdict(activeContexts int, budgetDrops int) string {
	if activeContexts > 0 && budgetDrops > 0 {
		return "Answered with " + pluralCount(activeContexts, "active context", "active contexts") + " and " + pluralCount(budgetDrops, "context dropped by budget", "contexts dropped by budget") + "."
	}
	if activeContexts > 0 {
		return "Answered with " + pluralCount(activeContexts, "active context", "active contexts") + "."
	}
	if budgetDrops > 0 {
		return "Answered with " + pluralCount(budgetDrops, "context dropped by budget", "contexts dropped by budget") + "."
	}
	return "Answered with no recorded context disposition changes."
}

func pluralCount(count int, singular string, plural string) string {
	if count == 1 {
		return "1 " + singular
	}
	return strconv.FormatInt(int64(count), 10) + " " + plural
}

func tokensFromMetrics(raw json.RawMessage) *TurnDecisionTokens {
	tokens := &TurnDecisionTokens{
		Input:  numericAttributeValue(raw, "inputTokens"),
		Output: numericAttributeValue(raw, "outputTokens"),
		Total:  numericAttributeValue(raw, "totalTokens"),
	}
	if *tokens == (TurnDecisionTokens{}) {
		return nil
	}
	return tokens
}

func costFromMetrics(raw json.RawMessage) *TurnDecisionCost {
	cost := &TurnDecisionCost{
		TotalUSD:  firstNonZeroFloat(numericAttributeValue(raw, "costUsd"), numericAttributeValue(raw, "totalCostUsd")),
		InputUSD:  numericAttributeValue(raw, "inputCostUsd"),
		OutputUSD: numericAttributeValue(raw, "outputCostUsd"),
	}
	if *cost == (TurnDecisionCost{}) {
		return nil
	}
	return cost
}

func numericAttributeValue(raw json.RawMessage, key string) float64 {
	value, ok := numericAttribute(raw, key)
	if !ok {
		return 0
	}
	return value
}

func firstNonZeroFloat(values ...float64) float64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func floatPtrValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
