package observability

import (
	"encoding/json"
	"sort"
	"time"
)

type requestProjectionIndex struct {
	artifactsByID      map[string]ArtifactSummary
	artifactsBySpan    map[string][]ArtifactSummary
	consumedBySpan     map[string][]ArtifactSummary
	spansByID          map[string]SpanSummary
	exactRequestBySpan map[string]*RunDetailRequest
}

func applyRunDetailRequests(root *RunDetailNode, graph Graph) {
	index := buildRequestProjectionIndex(graph)
	applyExactRequests(root, index)
	applyInheritedGenerationRequests(root, nil, index)
	applyAggregateRequests(root, index)
}

func buildRequestProjectionIndex(graph Graph) requestProjectionIndex {
	index := requestProjectionIndex{
		artifactsByID:      make(map[string]ArtifactSummary, len(graph.Artifacts)),
		artifactsBySpan:    make(map[string][]ArtifactSummary),
		consumedBySpan:     make(map[string][]ArtifactSummary),
		spansByID:          make(map[string]SpanSummary, len(graph.Spans)),
		exactRequestBySpan: make(map[string]*RunDetailRequest),
	}
	for _, span := range graph.Spans {
		index.spansByID[span.SpanID] = span
	}
	for _, artifact := range graph.Artifacts {
		index.artifactsByID[artifact.ArtifactID] = artifact
		if artifact.SpanID != "" {
			index.artifactsBySpan[artifact.SpanID] = append(index.artifactsBySpan[artifact.SpanID], artifact)
		}
	}
	for _, edge := range graph.Edges {
		if edge.EdgeType != "consumed" {
			continue
		}
		var spanID, artifactID string
		if edge.From.Kind == "span" && edge.To.Kind == "artifact" {
			spanID = edge.From.ID
			artifactID = edge.To.ID
		}
		if edge.From.Kind == "artifact" && edge.To.Kind == "span" {
			spanID = edge.To.ID
			artifactID = edge.From.ID
		}
		if spanID == "" || artifactID == "" {
			continue
		}
		if artifact, ok := index.artifactsByID[artifactID]; ok {
			index.consumedBySpan[spanID] = appendMissingArtifacts(index.consumedBySpan[spanID], artifact)
		}
	}
	for spanID := range index.artifactsBySpan {
		sortArtifactsStable(index.artifactsBySpan[spanID])
	}
	for spanID := range index.consumedBySpan {
		sortArtifactsStable(index.consumedBySpan[spanID])
	}
	return index
}

func applyExactRequests(node *RunDetailNode, index requestProjectionIndex) {
	if request := exactRequestForSpan(node.SpanSummary, index); request != nil {
		applyResolvedModelToSpan(&node.SpanSummary, index)
		request.ModelSummary = requestModelSummaryForSpans([]SpanSummary{node.SpanSummary}, node.SpanSummary, index)
		node.Request = request
		index.exactRequestBySpan[node.SpanID] = request
	}
	for i := range node.Details {
		detail := &node.Details[i]
		if request := exactRequestForSpan(detail.SpanSummary, index); request != nil {
			applyResolvedModelToSpan(&detail.SpanSummary, index)
			request.ModelSummary = requestModelSummaryForSpans([]SpanSummary{detail.SpanSummary}, detail.SpanSummary, index)
			detail.Request = request
			index.exactRequestBySpan[detail.SpanID] = request
		}
	}
	for i := range node.Children {
		applyExactRequests(&node.Children[i], index)
	}
}

func exactRequestForSpan(span SpanSummary, index requestProjectionIndex) *RunDetailRequest {
	if span.Family != "generation" {
		return nil
	}
	artifacts := appendMissingArtifacts(index.artifactsBySpan[span.SpanID], index.consumedBySpan[span.SpanID]...)
	messages := firstRequestMessagesArtifact(artifacts)
	if messages.ArtifactID == "" {
		return nil
	}
	ambientArtifacts := ambientRequestArtifactsForSpan(span, index)
	requestArtifacts := appendMissingArtifacts(artifacts, ambientArtifacts...)
	contributionArtifacts := requestContributionArtifactsForMessages(messages, requestArtifacts, index)
	budgetArtifact := firstArtifactOfKind(requestArtifacts, "prompt.budget")
	request := &RunDetailRequest{
		Mode:          "exact",
		Messages:      requestMessagesFromArtifact(messages),
		UserPrompt:    requestUserPromptFromMessages(messages),
		Contributions: requestContributionsForGeneration(messages, contributionArtifacts, budgetArtifact),
		Budget:        requestBudgetFromArtifact(budgetArtifact),
	}
	request.BasePrompt = requestBasePromptFromMessages(messages, span)
	request.Tools = requestToolsForSpan(messages, request.Contributions, span, index)
	return request
}

func firstRequestMessagesArtifact(artifacts []ArtifactSummary) ArtifactSummary {
	best := ArtifactSummary{}
	bestRank := 0
	for _, artifact := range artifacts {
		if !isRequestMessagesArtifact(artifact) {
			continue
		}
		rank := requestMessagesArtifactRank(artifact)
		if rank > bestRank {
			best = artifact
			bestRank = rank
		}
	}
	return best
}

func requestMessagesArtifactRank(artifact ArtifactSummary) int {
	fields := jsonObjectFields(artifact.Preview)
	if jsonRawString(fields["source"]) == "convex.agent" {
		switch jsonRawString(fields["phase"]) {
		case "thread-context":
			return 30
		case "call-args":
			return 20
		}
	}
	return 10
}

func isRequestMessagesArtifact(artifact ArtifactSummary) bool {
	if artifact.Kind != "messages" {
		return false
	}
	fields := jsonObjectFields(artifact.Preview)
	if fields == nil {
		return false
	}
	for _, key := range []string{
		"input",
		"system",
		"prompt",
		"userPrompt",
		"messages",
		"systemBlocks",
		"toolNames",
		"allMessages",
		"inputMessages",
		"inputPrompt",
		"recent",
		"existingResponses",
		"search",
	} {
		if _, ok := fields[key]; ok {
			return true
		}
	}
	return false
}

func requestContributionArtifactsForMessages(messages ArtifactSummary, artifacts []ArtifactSummary, index requestProjectionIndex) []ArtifactSummary {
	contributions := artifactsOfKind(artifacts, "context.contribution")
	fields := jsonObjectFields(messages.Preview)
	for _, block := range jsonArrayObjects(fields["systemBlocks"]) {
		artifactID := jsonRawString(block["artifactId"])
		if artifactID == "" {
			continue
		}
		artifact, ok := index.artifactsByID[artifactID]
		if !ok || artifact.Kind != "context.contribution" {
			continue
		}
		contributions = appendMissingArtifacts(contributions, artifact)
	}
	return contributions
}

func ambientRequestArtifactsForSpan(span SpanSummary, index requestProjectionIndex) []ArtifactSummary {
	var out []ArtifactSummary
	for current, ok := index.spansByID[span.ParentSpanID]; ok; current, ok = index.spansByID[current.ParentSpanID] {
		if !isAmbientRequestScope(current) {
			continue
		}
		out = appendMissingArtifacts(out, contextArtifactsWithinScopeBeforeSpan(current.SpanID, span, index)...)
		if budget := firstPromptBudgetWithinScopeBeforeSpan(current.SpanID, span, index); budget.ArtifactID != "" {
			out = appendMissingArtifacts(out, budget)
		}
		break
	}
	return out
}

func isAmbientRequestScope(span SpanSummary) bool {
	if span.Primitive == "generation.stream" {
		return true
	}
	switch span.Family {
	case "agent", "composition", "flow":
		return true
	default:
		return false
	}
}

func contextArtifactsWithinScopeBeforeSpan(scopeSpanID string, target SpanSummary, index requestProjectionIndex) []ArtifactSummary {
	var out []ArtifactSummary
	for _, artifact := range index.artifactsByID {
		if artifact.Kind != "context.contribution" {
			continue
		}
		if !artifactHappenedNoLaterThanSpan(artifact, target) {
			continue
		}
		if artifact.SpanID == scopeSpanID || spanDescendsFrom(artifact.SpanID, scopeSpanID, index.spansByID) {
			out = appendMissingArtifacts(out, artifact)
		}
	}
	sortArtifactsStable(out)
	return out
}

func firstPromptBudgetWithinScopeBeforeSpan(scopeSpanID string, target SpanSummary, index requestProjectionIndex) ArtifactSummary {
	var candidates []ArtifactSummary
	for _, artifact := range index.artifactsByID {
		if artifact.Kind != "prompt.budget" {
			continue
		}
		if !artifactHappenedNoLaterThanSpan(artifact, target) {
			continue
		}
		if artifact.SpanID == scopeSpanID || spanDescendsFrom(artifact.SpanID, scopeSpanID, index.spansByID) {
			candidates = append(candidates, artifact)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].CreatedAt != candidates[j].CreatedAt {
			return candidates[i].CreatedAt > candidates[j].CreatedAt
		}
		if candidates[i].SpanID != candidates[j].SpanID {
			return candidates[i].SpanID < candidates[j].SpanID
		}
		return candidates[i].ArtifactID < candidates[j].ArtifactID
	})
	if len(candidates) == 0 {
		return ArtifactSummary{}
	}
	return candidates[0]
}

func artifactHappenedNoLaterThanSpan(artifact ArtifactSummary, span SpanSummary) bool {
	if artifact.CreatedAt == "" || span.StartedAt == "" {
		return true
	}
	artifactTime, artifactErr := time.Parse(time.RFC3339Nano, artifact.CreatedAt)
	spanTime, spanErr := time.Parse(time.RFC3339Nano, span.StartedAt)
	if artifactErr != nil || spanErr != nil {
		return artifact.CreatedAt <= span.StartedAt
	}
	return !artifactTime.After(spanTime)
}

func spanDescendsFrom(spanID string, ancestorSpanID string, spansByID map[string]SpanSummary) bool {
	seen := map[string]struct{}{}
	for spanID != "" {
		if _, loop := seen[spanID]; loop {
			return false
		}
		seen[spanID] = struct{}{}
		span, ok := spansByID[spanID]
		if !ok {
			return false
		}
		if span.ParentSpanID == ancestorSpanID {
			return true
		}
		spanID = span.ParentSpanID
	}
	return false
}

func requestMessagesFromArtifact(artifact ArtifactSummary) *RunDetailRequestMessages {
	fields := jsonObjectFields(artifact.Preview)
	prompt := cloneRaw(fields["prompt"])
	if len(prompt) == 0 && decodePromptTextUserPrompt(fields["userPrompt"]) == nil {
		prompt = promptTextPlainFallback(fields["userPrompt"])
	}
	return &RunDetailRequestMessages{
		ArtifactID:        artifact.ArtifactID,
		Source:            jsonRawString(fields["source"]),
		Phase:             jsonRawString(fields["phase"]),
		Input:             cloneRaw(fields["input"]),
		System:            cloneRaw(fields["system"]),
		Prompt:            prompt,
		Messages:          cloneRaw(fields["messages"]),
		AllMessages:       cloneRaw(fields["allMessages"]),
		InputMessages:     cloneRaw(fields["inputMessages"]),
		InputPrompt:       cloneRaw(fields["inputPrompt"]),
		Recent:            cloneRaw(fields["recent"]),
		ExistingResponses: cloneRaw(fields["existingResponses"]),
		Search:            cloneRaw(fields["search"]),
	}
}

func requestUserPromptFromMessages(artifact ArtifactSummary) *RunDetailPromptTextUserPrompt {
	return decodePromptTextUserPrompt(jsonObjectFields(artifact.Preview)["userPrompt"])
}

func requestBasePromptFromMessages(artifact ArtifactSummary, span SpanSummary) *RunDetailRequestBasePrompt {
	fields := jsonObjectFields(artifact.Preview)
	for _, block := range jsonArrayObjects(fields["systemBlocks"]) {
		if jsonRawString(block["source"]) != "prompt" {
			continue
		}
		base := &RunDetailRequestBasePrompt{
			SourceID:      firstNonEmpty(span.PromptID, "prompt"),
			Text:          jsonRawString(block["text"]),
			Segments:      cloneRaw(block["segments"]),
			Tokens:        jsonRawNumberPtr(block["tokens"]),
			StaticTokens:  jsonRawNumberPtr(block["staticTokens"]),
			DynamicTokens: jsonRawNumberPtr(block["dynamicTokens"]),
		}
		if base.Text != "" || len(base.Segments) > 0 {
			return base
		}
	}
	if system := fields["system"]; len(system) > 0 {
		return &RunDetailRequestBasePrompt{SourceID: firstNonEmpty(span.PromptID, "messages.system"), Text: jsonRawString(system)}
	}
	if prompt := fields["prompt"]; len(prompt) > 0 {
		return &RunDetailRequestBasePrompt{SourceID: firstNonEmpty(span.PromptID, "messages.prompt"), Text: jsonRawString(prompt)}
	}
	return nil
}

func requestContributionsForGeneration(messages ArtifactSummary, contributions []ArtifactSummary, budget ArtifactSummary) []RunDetailRequestContribution {
	byArtifactID := make(map[string]RunDetailRequestContribution, len(contributions))
	bySourceID := make(map[string]RunDetailRequestContribution, len(contributions))
	for _, artifact := range contributions {
		contribution := requestContributionFromPreview(artifact.Preview)
		contribution.ArtifactID = artifact.ArtifactID
		contribution.SourceSpanID = artifact.SpanID
		if contribution.SourceID == "" {
			continue
		}
		byArtifactID[artifact.ArtifactID] = contribution
		bySourceID[contribution.SourceID] = contribution
	}

	ordered := make([]RunDetailRequestContribution, 0, len(contributions))
	seen := map[string]struct{}{}
	fields := jsonObjectFields(messages.Preview)
	for _, block := range jsonArrayObjects(fields["systemBlocks"]) {
		artifactID := jsonRawString(block["artifactId"])
		source := jsonRawString(block["source"])
		var contribution RunDetailRequestContribution
		var ok bool
		if artifactID != "" {
			contribution, ok = byArtifactID[artifactID]
		}
		if !ok && source != "" {
			contribution, ok = bySourceID[source]
		}
		if !ok || contribution.SourceID == "" {
			continue
		}
		if _, exists := seen[contribution.SourceID+"|"+contribution.State]; exists {
			continue
		}
		ordered = append(ordered, contribution)
		seen[contribution.SourceID+"|"+contribution.State] = struct{}{}
	}

	for _, artifact := range contributions {
		contribution := requestContributionFromPreview(artifact.Preview)
		if contribution.SourceID == "" {
			continue
		}
		key := contribution.SourceID + "|" + contribution.State
		if _, exists := seen[key]; exists {
			continue
		}
		contribution.ArtifactID = artifact.ArtifactID
		contribution.SourceSpanID = artifact.SpanID
		ordered = append(ordered, contribution)
		seen[key] = struct{}{}
	}

	if requestBudget := requestBudgetFromArtifact(budget); requestBudget != nil {
		for _, dropped := range requestBudget.Dropped {
			key := dropped.SourceID + "|" + dropped.State
			if _, exists := seen[key]; exists {
				continue
			}
			ordered = append(ordered, dropped)
			seen[key] = struct{}{}
		}
	}

	for index := range ordered {
		ordered[index].Order = index
	}
	return ordered
}

func requestContributionFromPreview(preview json.RawMessage) RunDetailRequestContribution {
	fields := jsonObjectFields(preview)
	freshness := jsonObjectFields(fields["freshness"])
	cache := jsonObjectFields(fields["cache"])
	return RunDetailRequestContribution{
		Kind:                   firstNonEmpty(jsonRawString(fields["kind"]), "context.contribution"),
		State:                  jsonRawString(fields["state"]),
		Included:               jsonRawBool(fields["included"]),
		SourceID:               jsonRawString(fields["sourceId"]),
		InjectableKind:         jsonRawString(fields["injectableKind"]),
		Reason:                 jsonRawString(fields["reason"]),
		Branch:                 jsonRawString(fields["branch"]),
		Injects:                jsonRawStringSlice(fields["injects"]),
		Priority:               jsonRawNumberPtr(fields["priority"]),
		SizeBytes:              jsonRawNumberPtr(fields["sizeBytes"]),
		Tokens:                 jsonRawNumberPtr(fields["tokens"]),
		CacheStatus:            firstNonEmpty(jsonRawString(fields["cacheStatus"]), jsonRawString(cache["status"])),
		CacheKey:               firstNonEmpty(jsonRawString(fields["cacheKey"]), jsonRawString(cache["cacheKey"]), jsonRawString(cache["key"])),
		CacheAgeMs:             firstNonNilFloat(jsonRawNumberPtr(fields["cacheAgeMs"]), jsonRawNumberPtr(cache["ageMs"])),
		CacheTTLMS:             firstNonNilFloat(jsonRawNumberPtr(fields["cacheTtlMs"]), jsonRawNumberPtr(fields["cacheTTLMS"]), jsonRawNumberPtr(cache["ttlMs"])),
		CacheReason:            firstNonEmpty(jsonRawString(fields["cacheReason"]), jsonRawString(cache["reason"])),
		InjectedTools:          jsonRawStringSlice(fields["injectedTools"]),
		Segments:               cloneRaw(fields["segments"]),
		StaticTokens:           jsonRawNumberPtr(fields["staticTokens"]),
		DynamicTokens:          jsonRawNumberPtr(fields["dynamicTokens"]),
		FreshnessStatus:        firstNonEmpty(jsonRawString(fields["freshnessStatus"]), jsonRawString(freshness["status"])),
		FreshnessAgeMs:         firstNonNilFloat(jsonRawNumberPtr(fields["freshnessAgeMs"]), jsonRawNumberPtr(freshness["ageMs"])),
		FreshnessMaxAgeMs:      firstNonNilFloat(jsonRawNumberPtr(fields["freshnessMaxAgeMs"]), jsonRawNumberPtr(freshness["maxAgeMs"])),
		FreshnessObservedAt:    firstNonEmpty(jsonRawString(fields["freshnessObservedAt"]), jsonRawString(freshness["observedAt"])),
		FreshnessValidUntil:    firstNonEmpty(jsonRawString(fields["freshnessValidUntil"]), jsonRawString(freshness["validUntil"])),
		FreshnessSourceVersion: firstNonEmpty(jsonRawString(fields["freshnessSourceVersion"]), jsonRawString(freshness["sourceVersion"])),
		FreshnessReason:        firstNonEmpty(jsonRawString(fields["freshnessReason"]), jsonRawString(freshness["reason"])),
		Text:                   jsonRawString(fields["text"]),
	}
}

func requestBudgetFromArtifact(artifact ArtifactSummary) *RunDetailRequestBudget {
	if artifact.ArtifactID == "" {
		return nil
	}
	fields := jsonObjectFields(artifact.Preview)
	budget := &RunDetailRequestBudget{
		ArtifactID:  artifact.ArtifactID,
		UsedTokens:  jsonRawNumberPtr(fields["usedTokens"]),
		TotalTokens: jsonRawNumberPtr(fields["totalTokens"]),
	}
	for _, rawDropped := range jsonArrayRaw(fields["dropped"]) {
		dropped := requestContributionFromPreview(rawDropped)
		if dropped.State == "" {
			dropped.State = "dropped-budget"
		}
		budget.Dropped = append(budget.Dropped, dropped)
	}
	budget.DroppedCount = len(budget.Dropped)
	return budget
}

func requestToolsForSpan(messages ArtifactSummary, contributions []RunDetailRequestContribution, span SpanSummary, index requestProjectionIndex) []RunDetailRequestTool {
	byName := map[string]*RunDetailRequestTool{}
	orderedNames := []string{}
	for _, contribution := range contributions {
		for _, name := range contribution.InjectedTools {
			if name == "" {
				continue
			}
			tool, ok := byName[name]
			if !ok {
				tool = &RunDetailRequestTool{Name: name, Origin: "injected"}
				byName[name] = tool
				orderedNames = append(orderedNames, name)
			}
			tool.SourceIDs = appendUniqueRequestString(tool.SourceIDs, contribution.SourceID)
			tool.InjectableKinds = appendUniqueRequestString(tool.InjectableKinds, contribution.InjectableKind)
		}
	}

	fields := jsonObjectFields(messages.Preview)
	for _, name := range jsonRawStringSlice(fields["toolNames"]) {
		if name == "" {
			continue
		}
		tool, ok := byName[name]
		if !ok {
			tool = &RunDetailRequestTool{Name: name, Origin: "request"}
			byName[name] = tool
			orderedNames = append(orderedNames, name)
		}
	}
	for _, name := range requestToolNamesFromSpanAndAncestors(span, index) {
		if name == "" {
			continue
		}
		tool, ok := byName[name]
		if !ok {
			tool = &RunDetailRequestTool{Name: name, Origin: "request"}
			byName[name] = tool
			orderedNames = append(orderedNames, name)
		}
	}

	out := make([]RunDetailRequestTool, 0, len(orderedNames))
	for _, name := range orderedNames {
		out = append(out, *byName[name])
	}
	return out
}

func requestToolNamesFromSpanAndAncestors(span SpanSummary, index requestProjectionIndex) []string {
	var names []string
	current := span
	for {
		names = appendRequestToolNames(names, current.Attributes)
		if current.ParentSpanID == "" {
			break
		}
		next, ok := index.spansByID[current.ParentSpanID]
		if !ok {
			break
		}
		current = next
	}
	return names
}

func appendRequestToolNames(names []string, attributes json.RawMessage) []string {
	fields := jsonObjectFields(attributes)
	for _, name := range jsonRawStringSlice(fields["toolNames"]) {
		names = appendUniqueRequestString(names, name)
	}
	return names
}

type inheritedRequestContext struct {
	span    SpanSummary
	request *RunDetailRequest
}

func applyInheritedGenerationRequests(node *RunDetailNode, inherited *inheritedRequestContext, index requestProjectionIndex) {
	current := inherited
	if node.Request != nil {
		current = &inheritedRequestContext{span: node.SpanSummary, request: node.Request}
	} else if detailRequest := inheritedRequestFromDetails(node.Details); detailRequest != nil {
		current = detailRequest
	} else if node.Family == "generation" && current != nil {
		applyResolvedModelToSpan(&node.SpanSummary, index)
		node.Request = inheritedRequestForGeneration(node.SpanSummary, *current, index)
		current = &inheritedRequestContext{span: node.SpanSummary, request: node.Request}
	}

	if node.Request == nil && node.Family == "generation" && current != nil {
		applyResolvedModelToSpan(&node.SpanSummary, index)
		node.Request = inheritedRequestForGeneration(node.SpanSummary, *current, index)
		current = &inheritedRequestContext{span: node.SpanSummary, request: node.Request}
	}

	for i := range node.Details {
		detail := &node.Details[i]
		if detail.Request == nil && detail.Family == "generation" && current != nil {
			applyResolvedModelToSpan(&detail.SpanSummary, index)
			detail.Request = inheritedRequestForGeneration(detail.SpanSummary, *current, index)
		}
	}
	for i := range node.Children {
		applyInheritedGenerationRequests(&node.Children[i], current, index)
	}
}

func inheritedRequestFromDetails(details []RunDetailDetail) *inheritedRequestContext {
	for _, detail := range details {
		if detail.Family == "generation" && detail.Request != nil {
			return &inheritedRequestContext{span: detail.SpanSummary, request: detail.Request}
		}
	}
	return nil
}

func inheritedRequestForGeneration(target SpanSummary, inherited inheritedRequestContext, index requestProjectionIndex) *RunDetailRequest {
	request := cloneRequest(inherited.request)
	if request == nil {
		return nil
	}
	request.Mode = "inherited"
	request.Representative = &RunDetailRequestRepresentative{
		SpanID:   inherited.span.SpanID,
		Strategy: "nearest-ancestor-request",
		Reason:   "nearest enclosing generation request",
	}
	request.Turns = nil
	if request.Messages != nil {
		request.Messages.PreviousStepMessages = previousStepMessagesForSpan(target, index)
	}
	request.ModelSummary = requestModelSummaryForSpans([]SpanSummary{target}, target, index)
	return request
}

type previousStepMessageSummary struct {
	SpanID    string          `json:"spanId"`
	Label     string          `json:"label"`
	StartedAt string          `json:"startedAt,omitempty"`
	Messages  json.RawMessage `json:"messages"`
}

func previousStepMessagesForSpan(target SpanSummary, index requestProjectionIndex) json.RawMessage {
	if target.ParentSpanID == "" {
		return nil
	}
	var siblings []SpanSummary
	for _, span := range index.spansByID {
		if span.ParentSpanID == target.ParentSpanID && span.Family == "generation" && span.SpanID != target.SpanID && spanStartedBefore(span, target) {
			siblings = append(siblings, span)
		}
	}
	sort.SliceStable(siblings, func(i, j int) bool {
		if siblings[i].StartedAt != siblings[j].StartedAt {
			return siblings[i].StartedAt < siblings[j].StartedAt
		}
		return siblings[i].SpanID < siblings[j].SpanID
	})

	var summaries []previousStepMessageSummary
	for _, sibling := range siblings {
		for _, artifact := range index.artifactsBySpan[sibling.SpanID] {
			if artifact.Kind != "messages" || isRequestMessagesArtifact(artifact) || len(artifact.Preview) == 0 {
				continue
			}
			summaries = append(summaries, previousStepMessageSummary{
				SpanID:    sibling.SpanID,
				Label:     firstNonEmpty(sibling.Name, sibling.PromptID),
				StartedAt: sibling.StartedAt,
				Messages:  cloneRaw(artifact.Preview),
			})
		}
	}
	if len(summaries) == 0 {
		return nil
	}
	raw, err := json.Marshal(summaries)
	if err != nil {
		return nil
	}
	return raw
}

func spanStartedBefore(left SpanSummary, right SpanSummary) bool {
	if left.StartedAt == "" || right.StartedAt == "" {
		return left.SpanID < right.SpanID
	}
	leftTime, leftErr := time.Parse(time.RFC3339Nano, left.StartedAt)
	rightTime, rightErr := time.Parse(time.RFC3339Nano, right.StartedAt)
	if leftErr != nil || rightErr != nil {
		return left.StartedAt < right.StartedAt
	}
	return leftTime.Before(rightTime)
}

func applyAggregateRequests(node *RunDetailNode, index requestProjectionIndex) {
	for i := range node.Children {
		applyAggregateRequests(&node.Children[i], index)
	}
	if !isRequestAggregator(node.SpanSummary) {
		return
	}
	generations := generationRequestsUnderNode(node, index)
	if len(generations) == 0 {
		return
	}
	sort.SliceStable(generations, func(i, j int) bool {
		left, leftErr := time.Parse(time.RFC3339Nano, generations[i].StartedAt)
		right, rightErr := time.Parse(time.RFC3339Nano, generations[j].StartedAt)
		if leftErr == nil && rightErr == nil && !left.Equal(right) {
			return left.Before(right)
		}
		return generations[i].SpanID < generations[j].SpanID
	})
	representative := generations[len(generations)-1]
	request := cloneRequest(representative.Request)
	if request == nil {
		return
	}
	request.Mode = "aggregate"
	request.Representative = &RunDetailRequestRepresentative{
		SpanID:   representative.SpanID,
		Strategy: "final-generation",
		Reason:   "latest descendant generation request",
	}
	request.ModelSummary = requestModelSummaryForGenerationNodes(generations, representative.SpanSummary, index)
	if request.ModelSummary != nil {
		node.Model = request.ModelSummary.PrimaryModel
		node.Provider = request.ModelSummary.PrimaryProvider
	}
	request.Turns = make([]RunDetailRequestTurn, 0, len(generations))
	for _, generation := range generations {
		model, provider := requestModelForSpan(generation.SpanSummary, index)
		request.Turns = append(request.Turns, RunDetailRequestTurn{
			SpanID:      generation.SpanID,
			Primitive:   generation.Primitive,
			Label:       firstNonEmpty(generation.Display.Label, generation.Name),
			StartedAt:   generation.StartedAt,
			Status:      generation.Status,
			RequestMode: generation.Request.Mode,
			Model:       model,
			Provider:    provider,
			PromptID:    generation.PromptID,
		})
	}
	node.Request = request
}

func requestModelSummaryForGenerationNodes(generations []RunDetailNode, primary SpanSummary, index requestProjectionIndex) *RunDetailRequestModelSummary {
	spans := make([]SpanSummary, 0, len(generations))
	for _, generation := range generations {
		spans = append(spans, generation.SpanSummary)
	}
	return requestModelSummaryForSpans(spans, primary, index)
}

func requestModelSummaryForSpans(spans []SpanSummary, primary SpanSummary, index requestProjectionIndex) *RunDetailRequestModelSummary {
	type modelBucket struct {
		model    string
		provider string
		spanIDs  []string
		count    int
	}
	buckets := map[string]*modelBucket{}
	orderedKeys := []string{}
	for _, span := range spans {
		model, provider := requestModelForSpan(span, index)
		if model == "" && provider == "" {
			continue
		}
		key := provider + "\x00" + model
		bucket, ok := buckets[key]
		if !ok {
			bucket = &modelBucket{model: model, provider: provider}
			buckets[key] = bucket
			orderedKeys = append(orderedKeys, key)
		}
		bucket.spanIDs = appendUniqueRequestString(bucket.spanIDs, span.SpanID)
		bucket.count++
	}
	if len(orderedKeys) == 0 {
		return nil
	}
	primaryModel, primaryProvider := requestModelForSpan(primary, index)
	if primaryModel == "" && primaryProvider == "" {
		last := buckets[orderedKeys[len(orderedKeys)-1]]
		primaryModel = last.model
		primaryProvider = last.provider
	}
	summary := &RunDetailRequestModelSummary{
		PrimaryModel:    primaryModel,
		PrimaryProvider: primaryProvider,
		Mixed:           len(orderedKeys) > 1,
		Models:          make([]RunDetailRequestModel, 0, len(orderedKeys)),
	}
	for _, key := range orderedKeys {
		bucket := buckets[key]
		summary.Models = append(summary.Models, RunDetailRequestModel{
			Model:    bucket.model,
			Provider: bucket.provider,
			SpanIDs:  append([]string(nil), bucket.spanIDs...),
			Count:    bucket.count,
		})
	}
	return summary
}

func applyResolvedModelToSpan(span *SpanSummary, index requestProjectionIndex) {
	model, provider := requestModelForSpan(*span, index)
	if model != "" {
		span.Model = model
	}
	if provider != "" {
		span.Provider = provider
	}
}

func requestModelForSpan(span SpanSummary, index requestProjectionIndex) (string, string) {
	model := firstNonEmpty(
		span.Model,
		stringAttribute(span.Attributes, "actualModelId"),
		stringAttribute(span.Attributes, "selectedModel"),
		stringAttribute(span.Attributes, "selectedModelId"),
		stringAttribute(span.Attributes, "modelId"),
		stringAttribute(span.Attributes, "model"),
	)
	provider := firstNonEmpty(span.Provider, stringAttribute(span.Attributes, "provider"), stringAttribute(span.Attributes, "providerId"))
	for _, artifact := range index.artifactsBySpan[span.SpanID] {
		artifactModel, artifactProvider := requestModelFromArtifact(artifact)
		model = firstNonEmpty(artifactModel, model)
		provider = firstNonEmpty(artifactProvider, provider)
	}
	provider = firstNonEmpty(provider, providerFromModelID(model))
	return model, provider
}

func requestModelFromArtifact(artifact ArtifactSummary) (string, string) {
	if artifact.Kind != "output" || len(artifact.Preview) == 0 {
		return "", ""
	}
	fields := jsonObjectFields(artifact.Preview)
	if fields == nil {
		return "", ""
	}
	meta := jsonObjectFields(fields["meta"])
	if meta == nil {
		return "", ""
	}
	model := firstNonEmpty(
		jsonRawString(meta["actualModelId"]),
		jsonRawString(meta["modelId"]),
		jsonRawString(meta["model"]),
	)
	provider := firstNonEmpty(jsonRawString(meta["provider"]), jsonRawString(meta["providerId"]), providerFromModelID(model))
	return model, provider
}

func isRequestAggregator(span SpanSummary) bool {
	if span.Primitive == "generation.stream" {
		return true
	}
	switch span.Family {
	case "run", "agent", "composition", "flow":
		return true
	default:
		return false
	}
}

func generationRequestsUnderNode(node *RunDetailNode, index requestProjectionIndex) []RunDetailNode {
	var out []RunDetailNode
	var visit func(RunDetailNode)
	visit = func(current RunDetailNode) {
		if current.SpanID != node.SpanID && isGenerationRequestTurn(current) && generationBelongsToAggregator(node.SpanSummary, current.SpanSummary, index) {
			out = append(out, current)
		}
		for _, detail := range current.Details {
			detailNode := RunDetailNode{
				SpanSummary: detail.SpanSummary,
				ID:          detail.ID,
				Display:     RunDetailDisplay{Label: detail.Label},
				Request:     detail.Request,
			}
			if isGenerationRequestTurn(detailNode) && generationBelongsToAggregator(node.SpanSummary, detail.SpanSummary, index) {
				out = append(out, RunDetailNode{
					SpanSummary: detail.SpanSummary,
					ID:          detail.ID,
					Display:     RunDetailDisplay{Label: detail.Label},
					Request:     detail.Request,
				})
			}
		}
		for _, child := range current.Children {
			visit(child)
		}
	}
	visit(*node)
	return out
}

func generationBelongsToAggregator(aggregator SpanSummary, candidate SpanSummary, index requestProjectionIndex) bool {
	if aggregator.SpanID == "" || candidate.SpanID == "" {
		return true
	}
	if aggregator.Primitive == "generation.stream" || aggregator.Family == "agent" {
		for spanID := candidate.SpanID; spanID != ""; {
			if spanID == aggregator.SpanID {
				return true
			}
			span, ok := index.spansByID[spanID]
			if !ok {
				return false
			}
			if span.SpanID != candidate.SpanID && span.Family != "generation" {
				return false
			}
			if span.ParentSpanID == aggregator.SpanID {
				return true
			}
			spanID = span.ParentSpanID
		}
		return false
	}
	return spanDescendsFrom(candidate.SpanID, aggregator.SpanID, index.spansByID)
}

func isGenerationRequestTurn(node RunDetailNode) bool {
	if node.Family != "generation" || node.Request == nil || node.Request.Mode == "aggregate" {
		return false
	}
	if node.Primitive == "generation.stream" && hasNestedGenerationRequest(node) {
		return false
	}
	return true
}

func hasNestedGenerationRequest(node RunDetailNode) bool {
	for _, detail := range node.Details {
		if detail.Family == "generation" && detail.Request != nil && detail.Request.Mode != "aggregate" {
			return true
		}
	}
	for _, child := range node.Children {
		if child.Family == "generation" && child.Request != nil && child.Request.Mode != "aggregate" {
			return true
		}
		if hasNestedGenerationRequest(child) {
			return true
		}
	}
	return false
}

func cloneRequest(request *RunDetailRequest) *RunDetailRequest {
	if request == nil {
		return nil
	}
	copy := *request
	if request.Representative != nil {
		representative := *request.Representative
		copy.Representative = &representative
	}
	if request.ModelSummary != nil {
		modelSummary := *request.ModelSummary
		modelSummary.Models = append([]RunDetailRequestModel(nil), request.ModelSummary.Models...)
		for index := range modelSummary.Models {
			modelSummary.Models[index].SpanIDs = append([]string(nil), modelSummary.Models[index].SpanIDs...)
		}
		copy.ModelSummary = &modelSummary
	}
	if request.BasePrompt != nil {
		basePrompt := *request.BasePrompt
		basePrompt.Segments = cloneRaw(request.BasePrompt.Segments)
		copy.BasePrompt = &basePrompt
	}
	if request.UserPrompt != nil {
		userPrompt := *request.UserPrompt
		userPrompt.Segments = append([]RunDetailPromptTextSegment(nil), request.UserPrompt.Segments...)
		copy.UserPrompt = &userPrompt
	}
	if request.Messages != nil {
		messages := *request.Messages
		messages.Input = cloneRaw(request.Messages.Input)
		messages.System = cloneRaw(request.Messages.System)
		messages.Prompt = cloneRaw(request.Messages.Prompt)
		messages.Messages = cloneRaw(request.Messages.Messages)
		messages.AllMessages = cloneRaw(request.Messages.AllMessages)
		messages.InputMessages = cloneRaw(request.Messages.InputMessages)
		messages.InputPrompt = cloneRaw(request.Messages.InputPrompt)
		messages.Recent = cloneRaw(request.Messages.Recent)
		messages.ExistingResponses = cloneRaw(request.Messages.ExistingResponses)
		messages.Search = cloneRaw(request.Messages.Search)
		messages.PreviousStepMessages = cloneRaw(request.Messages.PreviousStepMessages)
		copy.Messages = &messages
	}
	if request.Budget != nil {
		budget := *request.Budget
		budget.Dropped = append([]RunDetailRequestContribution(nil), request.Budget.Dropped...)
		copy.Budget = &budget
	}
	copy.Contributions = append([]RunDetailRequestContribution(nil), request.Contributions...)
	copy.Tools = append([]RunDetailRequestTool(nil), request.Tools...)
	copy.Turns = append([]RunDetailRequestTurn(nil), request.Turns...)
	copy.Diagnostics = append([]string(nil), request.Diagnostics...)
	return &copy
}

func firstArtifactOfKind(artifacts []ArtifactSummary, kind string) ArtifactSummary {
	for _, artifact := range artifacts {
		if artifact.Kind == kind {
			return artifact
		}
	}
	return ArtifactSummary{}
}

func sortArtifactsStable(artifacts []ArtifactSummary) {
	sort.SliceStable(artifacts, func(i, j int) bool {
		if artifacts[i].CreatedAt != artifacts[j].CreatedAt {
			return artifacts[i].CreatedAt < artifacts[j].CreatedAt
		}
		if artifacts[i].SpanID != artifacts[j].SpanID {
			return artifacts[i].SpanID < artifacts[j].SpanID
		}
		return artifacts[i].ArtifactID < artifacts[j].ArtifactID
	})
}

func artifactsOfKind(artifacts []ArtifactSummary, kind string) []ArtifactSummary {
	var out []ArtifactSummary
	for _, artifact := range artifacts {
		if artifact.Kind == kind {
			out = append(out, artifact)
		}
	}
	return out
}

func jsonObjectFields(raw json.RawMessage) map[string]json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil
	}
	return fields
}

func jsonArrayObjects(raw json.RawMessage) []map[string]json.RawMessage {
	values := jsonArrayRaw(raw)
	out := make([]map[string]json.RawMessage, 0, len(values))
	for _, value := range values {
		fields := jsonObjectFields(value)
		if fields != nil {
			out = append(out, fields)
		}
	}
	return out
}

func jsonArrayRaw(raw json.RawMessage) []json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	var values []json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil
	}
	return values
}

func jsonRawString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	return ""
}

func jsonRawBool(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	return false
}

func jsonRawNumberPtr(raw json.RawMessage) *float64 {
	if len(raw) == 0 {
		return nil
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return &value
}

func jsonRawStringSlice(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	return nil
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), raw...)
}

func appendUniqueRequestString(values []string, value string) []string {
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
