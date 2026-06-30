package observability

import "strings"

func freshnessEvidenceForContribution(contribution RunDetailRequestContribution) *TurnFreshnessEvidence {
	status := freshnessStatusForContribution(contribution)
	evidenceLevel := "declared"
	if status == "unknown" {
		evidenceLevel = "missing"
	}
	return &TurnFreshnessEvidence{
		Subject:       TurnDecisionSubject{Kind: firstNonEmpty(contribution.InjectableKind, "context"), ID: contribution.SourceID, Name: contributionName(contribution)},
		Status:        status,
		AgeMs:         floatPtrValue(contribution.FreshnessAgeMs),
		MaxAgeMs:      floatPtrValue(contribution.FreshnessMaxAgeMs),
		ObservedAt:    contribution.FreshnessObservedAt,
		ValidUntil:    contribution.FreshnessValidUntil,
		SourceVersion: contribution.FreshnessSourceVersion,
		Reason:        firstNonEmpty(contribution.FreshnessReason, status),
		EvidenceLevel: evidenceLevel,
	}
}

func freshnessStatusForContribution(contribution RunDetailRequestContribution) string {
	if status := normalizeFreshnessStatus(contribution.FreshnessStatus); status != "" {
		return status
	}
	state := strings.ToLower(contribution.State)
	switch {
	case strings.Contains(state, "stale-used"):
		return "stale-used"
	case strings.Contains(state, "stale-rejected"), strings.Contains(state, "stale"):
		return "stale-rejected"
	default:
		return "unknown"
	}
}

func normalizeFreshnessStatus(status string) string {
	switch strings.ToLower(strings.ReplaceAll(status, "_", "-")) {
	case "fresh", "refreshed", "stale-used", "stale-rejected", "unknown", "not-applicable":
		return strings.ToLower(strings.ReplaceAll(status, "_", "-"))
	case "":
		return ""
	default:
		return "unknown"
	}
}

func cacheAcceptedByFreshness(freshness *TurnFreshnessEvidence) bool {
	if freshness == nil {
		return false
	}
	switch freshness.Status {
	case "fresh", "refreshed", "stale-used", "not-applicable":
		return true
	default:
		return false
	}
}

func cacheRejectedByFreshness(freshness *TurnFreshnessEvidence) bool {
	return freshness != nil && freshness.Status == "stale-rejected"
}

func cacheFreshnessReasonCode(cache TurnCacheEvidence) string {
	if cache.RejectedByFreshness {
		return "cache.freshness.rejected"
	}
	if cache.AcceptedByFreshness {
		return "cache.freshness.accepted"
	}
	if cache.Subject.Kind == "context" {
		return "context.cache." + cache.Status
	}
	return "cache." + cache.Status
}

func freshnessEvidenceForSpan(span SpanSummary, subjectKind string) *TurnFreshnessEvidence {
	status := normalizeFreshnessStatus(stringAttribute(span.Attributes, "freshnessStatus"))
	if status == "" {
		return nil
	}
	evidenceLevel := "observed"
	if status == "unknown" {
		evidenceLevel = "missing"
	}
	return &TurnFreshnessEvidence{
		Subject:       TurnDecisionSubject{Kind: subjectKind, ID: span.SpanID, Name: firstNonEmpty(span.Name, span.Primitive)},
		Status:        status,
		AgeMs:         numericAttributeValue(span.Attributes, "freshnessAgeMs"),
		MaxAgeMs:      numericAttributeValue(span.Attributes, "freshnessMaxAgeMs"),
		ObservedAt:    stringAttribute(span.Attributes, "freshnessObservedAt"),
		ValidUntil:    stringAttribute(span.Attributes, "freshnessValidUntil"),
		SourceVersion: stringAttribute(span.Attributes, "freshnessSourceVersion"),
		Reason:        firstNonEmpty(stringAttribute(span.Attributes, "freshnessReason"), status),
		EvidenceLevel: evidenceLevel,
	}
}

func cacheEvidenceForSpan(span SpanSummary, status string, freshness *TurnFreshnessEvidence) *TurnCacheEvidence {
	if status == "" {
		return nil
	}
	return &TurnCacheEvidence{
		Subject:             TurnDecisionSubject{Kind: "cache", ID: span.SpanID, Name: firstNonEmpty(span.Name, span.Primitive)},
		Status:              status,
		CacheKey:            stringAttribute(span.Attributes, "cacheKey"),
		AgeMs:               numericAttributeValue(span.Attributes, "cacheAgeMs"),
		TTLMS:               numericAttributeValue(span.Attributes, "cacheTtlMs"),
		SavedTokens:         numericAttributeValue(span.Attributes, "savedTokens"),
		SavedCostUSD:        numericAttributeValue(span.Attributes, "savedCostUsd"),
		AcceptedByFreshness: cacheAcceptedByFreshness(freshness),
		RejectedByFreshness: cacheRejectedByFreshness(freshness),
		Reason:              firstNonEmpty(stringAttribute(span.Attributes, "cacheReason"), status),
		EvidenceLevel:       "observed",
		Tab:                 &TurnDeepTabTarget{Tab: "Cache", SpanID: span.SpanID},
	}
}

func firstNonNilFloat(values ...*float64) *float64 {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
