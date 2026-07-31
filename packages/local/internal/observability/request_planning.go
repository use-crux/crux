package observability

import "encoding/json"

type retainedRequestPlanContribution struct {
	ID              string
	Sources         []string
	Priority        *float64
	Boundary        string
	Representations []string
	Selected        string
}

func applyRequestPlan(request *RunDetailRequest, artifact ArtifactSummary) {
	if request == nil || artifact.ArtifactID == "" {
		return
	}
	fields := jsonObjectFields(artifact.Preview)
	if jsonRawString(fields["kind"]) != "request.plan" {
		return
	}
	receipt := jsonObjectFields(fields["receipt"])
	inspection := jsonObjectFields(fields["inspection"])
	requestID := jsonRawString(receipt["id"])
	if requestID == "" || jsonRawString(inspection["id"]) != requestID {
		return
	}
	plan := &RunDetailRequestPlan{
		ArtifactID:        artifact.ArtifactID,
		RequestID:         requestID,
		Model:             jsonRawString(receipt["model"]),
		InputTokens:       jsonRawNumberPtr(receipt["inputTokens"]),
		MaxInputTokens:    jsonRawNumberPtr(receipt["maxInputTokens"]),
		Measurement:       jsonRawString(receipt["measurement"]),
		PreviousRequestID: jsonRawString(receipt["previousRequestId"]),
	}
	adaptations := make(map[string]RunDetailRequestAdaptation)
	for _, raw := range jsonArrayRaw(receipt["adaptations"]) {
		adaptation := requestPlanAdaptation(raw)
		if adaptation.Contributor == "" {
			continue
		}
		plan.Adaptations = append(plan.Adaptations, adaptation)
		adaptations[adaptation.Contributor] = adaptation
	}
	for _, raw := range jsonArrayRaw(receipt["warnings"]) {
		warningFields := jsonObjectFields(raw)
		warning := RunDetailRequestWarning{
			Code:    jsonRawString(warningFields["code"]),
			Message: jsonRawString(warningFields["message"]),
		}
		if warning.Code != "" {
			plan.Warnings = append(plan.Warnings, warning)
		}
	}
	selected := selectedRequestRepresentations(inspection["candidates"])
	planned := requestPlanContributions(inspection["contributions"], selected)
	request.Contributions = mergePlannedContributions(request.Contributions, planned, adaptations)
	request.Plan = plan
	request.Budget = requestPlanBudget(artifact.ArtifactID, plan, request.Contributions)
}

func requestPlanAdaptation(raw json.RawMessage) RunDetailRequestAdaptation {
	fields := jsonObjectFields(raw)
	return RunDetailRequestAdaptation{
		Contributor:       jsonRawString(fields["contributor"]),
		Representation:    jsonRawString(fields["representation"]),
		FullTokens:        jsonRawNumberPtr(fields["fullTokens"]),
		SelectedTokens:    jsonRawNumberPtr(fields["selectedTokens"]),
		SupportRequestID:  jsonRawString(fields["supportRequestId"]),
		SupportRequestIDs: jsonRawStringSlice(fields["supportRequestIds"]),
	}
}

func selectedRequestRepresentations(raw json.RawMessage) map[string]string {
	selected := map[string]string{}
	for _, candidateRaw := range jsonArrayRaw(raw) {
		fields := jsonObjectFields(candidateRaw)
		if !jsonRawBool(fields["selected"]) {
			continue
		}
		selected[jsonRawString(fields["contributor"])] = jsonRawString(fields["representation"])
	}
	return selected
}

func requestPlanContributions(raw json.RawMessage, selected map[string]string) []retainedRequestPlanContribution {
	var contributions []retainedRequestPlanContribution
	for _, contributionRaw := range jsonArrayRaw(raw) {
		fields := jsonObjectFields(contributionRaw)
		id := jsonRawString(fields["id"])
		if id == "" {
			continue
		}
		selectedRepresentation := selected[id]
		representations := jsonRawStringSlice(fields["representations"])
		if selectedRepresentation == "" && len(representations) == 1 && representations[0] == "full" {
			selectedRepresentation = "full"
		}
		contributions = append(contributions, retainedRequestPlanContribution{
			ID:              id,
			Sources:         jsonRawStringSlice(fields["sources"]),
			Priority:        jsonRawNumberPtr(fields["priority"]),
			Boundary:        jsonRawString(fields["boundary"]),
			Representations: representations,
			Selected:        selectedRepresentation,
		})
	}
	return contributions
}

func mergePlannedContributions(
	existing []RunDetailRequestContribution,
	planned []retainedRequestPlanContribution,
	adaptations map[string]RunDetailRequestAdaptation,
) []RunDetailRequestContribution {
	owned := map[string]struct{}{}
	for _, contribution := range planned {
		owned[contribution.ID] = struct{}{}
		for _, source := range contribution.Sources {
			owned[source] = struct{}{}
		}
	}
	merged := make([]RunDetailRequestContribution, 0, len(existing)+len(planned))
	for _, contribution := range existing {
		if _, replaced := owned[contribution.SourceID]; !replaced {
			merged = append(merged, contribution)
		}
	}
	for _, contribution := range planned {
		projected := RunDetailRequestContribution{
			Kind: "context.contribution", State: "active", Included: true,
			SourceID: contribution.ID, InjectableKind: "context",
			Boundary:               contribution.Boundary,
			Representations:        append([]string(nil), contribution.Representations...),
			SelectedRepresentation: contribution.Selected,
			Priority:               contribution.Priority,
		}
		for _, current := range existing {
			if !containsRequestString(contribution.Sources, current.SourceID) {
				continue
			}
			projected.Injects = appendUniqueRequestStrings(projected.Injects, current.Injects...)
			projected.InjectedTools = appendUniqueRequestStrings(projected.InjectedTools, current.InjectedTools...)
			if projected.InjectableKind == "context" && current.InjectableKind != "" {
				projected.InjectableKind = current.InjectableKind
			}
		}
		if adaptation, ok := adaptations[contribution.ID]; ok {
			copy := adaptation
			projected.Adaptation = &copy
			projected.SelectedRepresentation = adaptation.Representation
			if adaptation.Representation == "omitted" {
				projected.State = "dropped-budget"
				projected.Included = false
				projected.Reason = "omitted by request planning"
			}
		}
		merged = append(merged, projected)
	}
	for index := range merged {
		merged[index].Order = index
	}
	return merged
}

func requestPlanBudget(artifactID string, plan *RunDetailRequestPlan, contributions []RunDetailRequestContribution) *RunDetailRequestBudget {
	budget := &RunDetailRequestBudget{
		ArtifactID:  artifactID,
		UsedTokens:  plan.InputTokens,
		TotalTokens: plan.MaxInputTokens,
	}
	for _, contribution := range contributions {
		if contribution.State == "dropped-budget" {
			budget.Dropped = append(budget.Dropped, contribution)
		}
	}
	budget.DroppedCount = len(budget.Dropped)
	return budget
}

func containsRequestString(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func appendUniqueRequestStrings(values []string, candidates ...string) []string {
	for _, candidate := range candidates {
		values = appendUniqueRequestString(values, candidate)
	}
	return values
}
