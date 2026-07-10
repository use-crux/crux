package observability

import "strings"

func appendRuntimeDecisionEvidence(report *TurnDecisionReport, turn SpanSummary, details []RunDetailDetail, children []RunDetailNode) {
	for _, detail := range details {
		if decisions, chips, model, ok := routingReceiptDecisionsForDetail(turn, detail); ok {
			setRoutingReceiptModel(report, model)
			for _, decision := range decisions {
				appendDecisionReportRuntimeDecision(report, decision)
			}
			report.Chips = appendRoutingDecisionChips(report.Chips, chips...)
			report.Source = appendSourceGroupItem(report.Source, sourceGroupForRuntimeFamily(detail.Family), runtimeSourceJoin(detail.SpanSummary))
		} else if decision, ok := runtimeDecisionForSpan(turn, detail.SpanSummary); ok {
			appendDecisionReportRuntimeDecision(report, decision)
			report.Source = appendSourceGroupItem(report.Source, sourceGroupForRuntimeFamily(detail.Family), runtimeSourceJoin(detail.SpanSummary))
		}
	}
	for _, child := range children {
		if decisions, chips, model, ok := routingReceiptDecisionsForNode(turn, child); ok {
			setRoutingReceiptModel(report, model)
			for _, decision := range decisions {
				appendDecisionReportRuntimeDecision(report, decision)
			}
			report.Chips = appendRoutingDecisionChips(report.Chips, chips...)
			report.Source = appendSourceGroupItem(report.Source, sourceGroupForRuntimeFamily(child.Family), runtimeSourceJoin(child.SpanSummary))
		} else if decision, ok := runtimeDecisionForSpan(turn, child.SpanSummary); ok {
			appendDecisionReportRuntimeDecision(report, decision)
			report.Source = appendSourceGroupItem(report.Source, sourceGroupForRuntimeFamily(child.Family), runtimeSourceJoin(child.SpanSummary))
		}
		appendRuntimeDecisionEvidence(report, turn, child.Details, child.Children)
	}
}

// setRoutingReceiptModel fills a missing generation model from the canonical receipt.
func setRoutingReceiptModel(report *TurnDecisionReport, model string) {
	if report.Turn.Model == "" {
		report.Turn.Model = model
	}
}

func appendDecisionReportRuntimeDecision(report *TurnDecisionReport, decision TurnDecision) {
	report.Decisions = append(report.Decisions, decision)
	if decision.Freshness != nil {
		report.Freshness = append(report.Freshness, *decision.Freshness)
	}
	if decision.Cache != nil {
		report.Cache = append(report.Cache, *decision.Cache)
	}
}

func runtimeDecisionForSpan(turn SpanSummary, span SpanSummary) (TurnDecision, bool) {
	switch span.Family {
	case "routing":
		return routingDecisionForSpan(turn, span), true
	case "guardrail":
		return guardDecisionForSpan(turn, span, "guardrail", "Guardrail"), true
	case "constraint":
		return guardDecisionForSpan(turn, span, "constraint", "Constraint"), true
	case "security":
		return guardDecisionForSpan(turn, span, "security", "Security"), true
	case "cache":
		return cacheRuntimeDecisionForSpan(turn, span), true
	case "compaction":
		return compactionDecisionForSpan(turn, span), true
	case "retrieval":
		return retrievalDecisionForSpan(turn, span), true
	case "memory":
		return memoryDecisionForSpan(turn, span), true
	default:
		if strings.Contains(span.Primitive, "fallback") {
			return fallbackDecisionForSpan(turn, span), true
		}
		return TurnDecision{}, false
	}
}

func routingDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	outcome := firstNonEmpty(stringAttribute(span.Attributes, "selectedModel"), stringAttribute(span.Attributes, "chosen"), span.Status)
	reasonCode := "routing.router.selected"
	if strings.Contains(span.Primitive, "cascade") {
		reasonCode = "routing.cascade.tier_accepted"
	}
	if strings.Contains(span.Primitive, "fallback") {
		reasonCode = "routing.fallback.fired"
	}
	return runtimeDecision(turn, span, "model-selection", span.Primitive, "route", outcome, observedReason(reasonCode, "Routing decision was observed."), "Routing")
}

func guardDecisionForSpan(turn SpanSummary, span SpanSummary, subjectKind string, tab string) TurnDecision {
	status := strings.ToLower(firstNonEmpty(span.Status, "unknown"))
	outcome := status
	codeStatus := status
	switch status {
	case "ok", "success", "passed":
		codeStatus = "passed"
	case "warn", "warning":
		codeStatus = "warned"
	case "blocked", "error":
		codeStatus = "blocked"
	default:
		codeStatus = "passed"
	}
	return runtimeDecision(turn, span, "checks", span.Primitive, subjectKind, outcome, observedReason(subjectKind+"."+codeStatus, subjectKind+" decision was observed."), tab)
}

func cacheRuntimeDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	status := normalizeCacheStatus(firstNonEmpty(stringAttribute(span.Attributes, "status"), span.Status))
	if status == "" || status == "ok" {
		status = "unknown"
	}
	decision := runtimeDecision(turn, span, "efficiency", span.Primitive, "cache", status, observedReason("cache."+status, "Cache decision was observed."), "Cache")
	freshness := freshnessEvidenceForSpan(span, "cache")
	decision.Freshness = freshness
	decision.Cache = cacheEvidenceForSpan(span, status, freshness)
	if decision.Cache != nil {
		decision.Reason = observedReason(cacheFreshnessReasonCode(*decision.Cache), "Cache decision was observed with freshness evidence.")
	}
	return decision
}

func compactionDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	status := "applied"
	if strings.EqualFold(span.Status, "skipped") {
		status = "skipped"
	}
	return runtimeDecision(turn, span, "efficiency", span.Primitive, "compaction", status, observedReason("compaction."+status, "Compaction decision was observed."), "Compaction")
}

func retrievalDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	outcome := "returned_hits"
	if count, ok := numericAttribute(span.Attributes, "resultCount"); ok && count == 0 {
		outcome = "returned_empty"
	}
	decision := runtimeDecision(turn, span, "data", span.Primitive, "retrieval", outcome, observedReason("retrieval."+outcome, "Retrieval decision was observed."), "Context")
	decision.Freshness = freshnessEvidenceForSpan(span, "retrieval")
	return decision
}

func memoryDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	code := "memory.recalled"
	if strings.Contains(span.Primitive, "write") {
		code = "memory.written"
	}
	decision := runtimeDecision(turn, span, "data", span.Primitive, "memory", span.Status, observedReason(code, "Memory decision was observed."), "Context")
	decision.Freshness = freshnessEvidenceForSpan(span, "memory")
	return decision
}

func fallbackDecisionForSpan(turn SpanSummary, span SpanSummary) TurnDecision {
	code := "routing.fallback.attempt_started"
	switch strings.ToLower(span.Status) {
	case "ok", "success":
		code = "routing.fallback.attempt_succeeded"
	case "error", "failed":
		code = "routing.fallback.attempt_failed"
	}
	return runtimeDecision(turn, span, "recovery", span.Primitive, "route", span.Status, observedReason(code, "Fallback decision was observed."), "Routing")
}

func runtimeDecision(turn SpanSummary, span SpanSummary, phase string, kind string, subjectKind string, outcome string, reason TurnDecisionReason, tab string) TurnDecision {
	return TurnDecision{
		ID:      "decision:" + turn.SpanID + ":" + decisionIDKind(span, subjectKind) + ":" + span.SpanID,
		Phase:   phase,
		Kind:    firstNonEmpty(kind, span.Primitive, span.Family),
		Subject: TurnDecisionSubject{Kind: subjectKind, ID: span.SpanID, Name: firstNonEmpty(span.Name, span.Primitive)},
		Outcome: firstNonEmpty(outcome, span.Status, "unknown"),
		Reason:  reason,
		Source:  ptrSourceJoin(runtimeSourceJoin(span)),
		Tab:     &TurnDeepTabTarget{Tab: tab, SpanID: span.SpanID},
		Evidence: []TurnEvidenceRef{{
			Kind:      "span",
			SpanID:    span.SpanID,
			Primitive: span.Primitive,
			Role:      "decision",
		}},
		Metrics: &TurnDecisionMetrics{DurationMs: span.DurationMs},
	}
}

func runtimeSourceJoin(span SpanSummary) TurnSourceJoin {
	return TurnSourceJoin{
		ID:               firstNonEmpty(span.PromptID, span.ContextID, span.ToolName, span.MemoryID, span.RetrieverID, span.SpanID),
		Kind:             firstNonEmpty(span.Family, span.Primitive),
		Name:             firstNonEmpty(span.Name, span.Primitive, span.SpanID),
		Status:           "decision-only",
		Fidelity:         "runtime-join",
		UnresolvedReason: "",
	}
}

func observedReason(code string, text string) TurnDecisionReason {
	return TurnDecisionReason{
		Code:          code,
		Text:          firstNonEmpty(text, code),
		EvidenceLevel: "observed",
		Source:        "span-attribute",
	}
}

func decisionIDKind(span SpanSummary, subjectKind string) string {
	if span.Family == "routing" {
		return "routing"
	}
	return subjectKind
}

func sourceGroupForRuntimeFamily(family string) string {
	switch family {
	case "routing":
		return "Routing"
	case "guardrail":
		return "Guardrails"
	case "constraint":
		return "Constraints"
	case "security":
		return "Guardrails"
	case "retrieval":
		return "Retrievers"
	case "memory":
		return "Contexts"
	case "tool":
		return "Tools"
	default:
		return "Contexts"
	}
}

func appendSourceGroupItem(groups []TurnSourceGroup, groupName string, item TurnSourceJoin) []TurnSourceGroup {
	if groupName == "" {
		return groups
	}
	for index := range groups {
		if groups[index].Group == groupName {
			groups[index].Items = append(groups[index].Items, item)
			return groups
		}
	}
	return append(groups, TurnSourceGroup{Group: groupName, Items: []TurnSourceJoin{item}})
}
