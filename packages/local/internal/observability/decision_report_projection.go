package observability

import "strings"

func applyRunDetailDecisionReports(root *RunDetailNode) {
	if root.Family == "generation" {
		root.DecisionReport = buildTurnDecisionReportForNode(root)
	}
	for i := range root.Details {
		detail := &root.Details[i]
		if detail.Family == "generation" {
			detail.DecisionReport = buildTurnDecisionReport(detail.SpanSummary, detail.Request)
		}
	}
	for i := range root.Children {
		applyRunDetailDecisionReports(&root.Children[i])
	}
}

func buildTurnDecisionReportForNode(node *RunDetailNode) *TurnDecisionReport {
	report := buildTurnDecisionReport(node.SpanSummary, node.Request)
	appendRuntimeDecisionEvidence(report, node.SpanSummary, node.Details, node.Children)
	return report
}

func buildTurnDecisionReport(span SpanSummary, request *RunDetailRequest) *TurnDecisionReport {
	report := &TurnDecisionReport{
		SchemaVersion: 1,
		ReportID:      "tdr:" + span.RunID + ":" + span.SpanID,
		RunID:         span.RunID,
		TraceID:       span.TraceID,
		Turn:          turnDecisionTurnFromSpan(span, request),
		Coverage:      defaultTurnDecisionCoverage(),
	}
	defer normalizeTurnDecisionReportCollections(report)
	if request == nil {
		report.Gaps = append(report.Gaps, missingRequestGap(span))
		report.Turn.Verdict = "Answered with request composition evidence unavailable."
		return report
	}

	promptSource := sourceJoinForPrompt(request.BasePrompt, span)
	if request.BasePrompt != nil {
		report.Saw = append(report.Saw, TurnSawItem{
			Kind:          "prompt",
			Name:          firstNonEmpty(request.BasePrompt.SourceID, span.PromptID, "prompt"),
			ID:            request.BasePrompt.SourceID,
			Disposition:   "active",
			Tokens:        floatPtrValue(request.BasePrompt.Tokens),
			EvidenceLevel: "declared",
			SourceStatus:  promptSource.Status,
			Source:        &promptSource,
			Tab:           &TurnDeepTabTarget{Tab: "Context", AnchorID: request.BasePrompt.SourceID, SpanID: span.SpanID},
		})
	}

	contextSources := make([]TurnSourceJoin, 0, len(request.Contributions))
	activeContexts := 0
	budgetDrops := 0
	missingFreshness := false
	for _, contribution := range request.Contributions {
		source := sourceJoinForContribution(contribution)
		contextSources = append(contextSources, source)
		disposition := dispositionForContribution(contribution)
		reason := reasonForContribution(contribution, disposition)
		metrics := metricsForContribution(contribution)
		freshness := freshnessEvidenceForContribution(contribution)
		cache := cacheEvidenceForContribution(contribution, freshness)
		if freshness != nil {
			report.Freshness = append(report.Freshness, *freshness)
			if freshness.EvidenceLevel == "missing" {
				missingFreshness = true
			}
		}
		if cache != nil {
			report.Cache = append(report.Cache, *cache)
			report.Decisions = append(report.Decisions, cacheDecisionForContribution(span, contribution, *cache))
		}

		switch disposition {
		case "active":
			activeContexts++
			saw := TurnSawItem{
				Kind:          firstNonEmpty(contribution.InjectableKind, "context"),
				Name:          contributionName(contribution),
				ID:            contribution.SourceID,
				Disposition:   "active",
				Tokens:        floatPtrValue(contribution.Tokens),
				EvidenceLevel: reason.EvidenceLevel,
				SourceStatus:  source.Status,
				Source:        &source,
				Tab:           contextTab(contribution),
			}
			saw.Freshness = freshness
			saw.Cache = cache
			report.Saw = append(report.Saw, saw)
		default:
			if reasonStateForContribution(contribution, disposition) == "budget" {
				budgetDrops++
			}
			report.Considered = append(report.Considered, TurnConsideredItem{
				Kind:          firstNonEmpty(contribution.InjectableKind, "context"),
				Name:          contributionName(contribution),
				ID:            contribution.SourceID,
				Disposition:   disposition,
				ReasonState:   reasonStateForContribution(contribution, disposition),
				Reason:        reason,
				Tokens:        floatPtrValue(contribution.Tokens),
				Freshness:     freshness,
				Cache:         cache,
				EvidenceLevel: reason.EvidenceLevel,
				SourceStatus:  source.Status,
				Source:        &source,
				Tab:           contextTab(contribution),
			})
		}

		report.Decisions = append(report.Decisions, TurnDecision{
			ID:        "decision:" + span.SpanID + ":" + firstNonEmpty(contribution.SourceID, contribution.ArtifactID, contribution.Kind),
			Phase:     "request",
			Kind:      "context.disposition",
			Subject:   TurnDecisionSubject{Kind: "context", ID: contribution.SourceID, Name: contributionName(contribution)},
			Outcome:   disposition,
			Reason:    reason,
			Source:    &source,
			Tab:       contextTab(contribution),
			Evidence:  evidenceForContribution(contribution),
			Freshness: freshness,
			Cache:     cache,
			Metrics:   metrics,
		})
	}

	if request.Budget != nil {
		report.Decisions = append(report.Decisions, budgetDecision(span, request.Budget))
	}
	for _, tool := range request.Tools {
		report.Saw = append(report.Saw, sawToolItem(span, tool))
		report.Decisions = append(report.Decisions, toolDecision(span, tool))
	}

	report.Source = sourceGroups(promptSource, contextSources)
	if len(report.Freshness) == 0 || missingFreshness {
		report.Gaps = append(report.Gaps, missingFreshnessGap(span))
	}
	report.Turn.Verdict = turnVerdict(activeContexts, budgetDrops)
	return report
}

func turnDecisionTurnFromSpan(span SpanSummary, request *RunDetailRequest) TurnDecisionTurn {
	model, provider := span.Model, span.Provider
	if request != nil && request.ModelSummary != nil {
		model = firstNonEmpty(model, request.ModelSummary.PrimaryModel)
		provider = firstNonEmpty(provider, request.ModelSummary.PrimaryProvider)
	}
	turn := TurnDecisionTurn{
		ID:           span.SpanID,
		Kind:         span.Primitive,
		Name:         span.Name,
		Model:        model,
		Provider:     provider,
		Status:       span.Status,
		FinishReason: stringAttribute(span.Attributes, "finishReason"),
		DurMs:        span.DurationMs,
		TTFTMs:       numericAttributeValue(span.Metrics, "ttftMs"),
	}
	if tokens := tokensFromMetrics(span.Metrics); tokens != nil {
		turn.Tokens = tokens
	}
	if cost := costFromMetrics(span.Metrics); cost != nil {
		turn.Cost = cost
	}
	return turn
}

func sourceJoinForPrompt(prompt *RunDetailRequestBasePrompt, span SpanSummary) TurnSourceJoin {
	id := span.PromptID
	if prompt != nil {
		id = firstNonEmpty(prompt.SourceID, id)
	}
	return TurnSourceJoin{
		ID:               id,
		Kind:             "prompt",
		Name:             firstNonEmpty(id, span.Name),
		Status:           "used",
		Fidelity:         fidelityForSourceID(id),
		UnresolvedReason: unresolvedReasonForSourceID(id),
	}
}

func sourceJoinForContribution(contribution RunDetailRequestContribution) TurnSourceJoin {
	return TurnSourceJoin{
		ID:               contribution.SourceID,
		Kind:             firstNonEmpty(contribution.InjectableKind, "context"),
		Name:             contributionName(contribution),
		Status:           sourceStatusForDisposition(dispositionForContribution(contribution)),
		Fidelity:         fidelityForSourceID(contribution.SourceID),
		UnresolvedReason: unresolvedReasonForSourceID(contribution.SourceID),
	}
}

func dispositionForContribution(contribution RunDetailRequestContribution) string {
	state := strings.ToLower(contribution.State)
	if contribution.Included || state == "active" {
		return "active"
	}
	switch {
	case strings.Contains(state, "disabled"):
		return "disabled"
	case strings.Contains(state, "drop"):
		return "dropped"
	case strings.Contains(state, "checked"):
		return "checked"
	case state == "":
		return "unknown"
	default:
		return "checked"
	}
}

func reasonStateForContribution(contribution RunDetailRequestContribution, disposition string) string {
	state := strings.ToLower(contribution.State)
	switch {
	case strings.Contains(state, "budget"):
		return "budget"
	case strings.Contains(state, "disabled") || disposition == "disabled":
		return "disabled"
	case strings.Contains(state, "stale"):
		return "stale-rejected"
	case disposition == "checked":
		return "unknown"
	default:
		return ""
	}
}

func reasonForContribution(contribution RunDetailRequestContribution, disposition string) TurnDecisionReason {
	code := "context." + disposition
	reasonState := reasonStateForContribution(contribution, disposition)
	if disposition == "active" && freshnessStatusForContribution(contribution) == "stale-used" {
		code = "context.freshness.stale_used"
	}
	if reasonState == "stale-rejected" {
		code = "context.freshness.stale_rejected"
	}
	if disposition == "dropped" && reasonState == "budget" {
		code = "context.dropped.token_budget"
	}
	return declaredReason(code, firstNonEmpty(contribution.Reason, contribution.State, disposition))
}

func budgetDecision(span SpanSummary, budget *RunDetailRequestBudget) TurnDecision {
	metrics := &TurnDecisionMetrics{
		Tokens: floatPtrValue(budget.UsedTokens),
	}
	return TurnDecision{
		ID:      "decision:" + span.SpanID + ":budget",
		Phase:   "request",
		Kind:    "prompt-budget",
		Subject: TurnDecisionSubject{Kind: "prompt-budget", ID: budget.ArtifactID, Label: "Prompt budget"},
		Outcome: "applied",
		Reason:  declaredReason("budget.applied", "Prompt budget was applied."),
		Tab:     &TurnDeepTabTarget{Tab: "Context", ArtifactID: budget.ArtifactID, SpanID: span.SpanID},
		Evidence: []TurnEvidenceRef{{
			Kind:         "artifact",
			ArtifactID:   budget.ArtifactID,
			ArtifactKind: "prompt.budget",
			SpanID:       span.SpanID,
			Role:         "budget",
		}},
		Metrics: metrics,
	}
}
