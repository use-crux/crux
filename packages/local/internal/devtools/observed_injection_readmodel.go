package devtools

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const observedInjectionSchemaVersion = 1

// observedInjectionReadModel summarizes runtime-observed injection behavior without
// folding it back into the static Project Index snapshot. Keeping the read model
// separate lets devtools compare "authored possibility" with "observed reality"
// without pretending traces are exhaustive.
type observedInjectionReadModel struct {
	SchemaVersion     int                       `json:"schemaVersion"`
	RunCount          int                       `json:"runCount"`
	ContributionCount int                       `json:"contributionCount"`
	Sources           []observedInjectionSource `json:"sources"`
	Inputs            []observedPromptInput     `json:"inputs,omitempty"`
	Drift             []observedInjectionDrift  `json:"drift,omitempty"`
}

// observedInjectionSource is the aggregate for one runtime sourceId, such as
// context:brand, injectable:search-tools, memory:recent, or blackboard:workspace.
type observedInjectionSource struct {
	ID                 string                         `json:"id"`
	SourceID           string                         `json:"sourceId"`
	DefinitionID       string                         `json:"definitionId,omitempty"`
	DefinitionKind     string                         `json:"definitionKind,omitempty"`
	InjectableKind     string                         `json:"injectableKind,omitempty"`
	ObservedCount      int                            `json:"observedCount"`
	IncludedCount      int                            `json:"includedCount"`
	ExcludedCount      int                            `json:"excludedCount"`
	DroppedBudgetCount int                            `json:"droppedBudgetCount"`
	PromptIDs          []string                       `json:"promptIds,omitempty"`
	RunRefs            []observedInjectionRunRef      `json:"runRefs,omitempty"`
	States             []observedInjectionCount       `json:"states,omitempty"`
	Injects            []observedInjectionCount       `json:"injects,omitempty"`
	Tools              []observedInjectionCount       `json:"tools,omitempty"`
	Branches           []observedInjectionBranchCount `json:"branches,omitempty"`
	CacheStatuses      []observedInjectionCount       `json:"cacheStatuses,omitempty"`
	IndexMatch         *observedInjectionIndexMatch   `json:"indexMatch,omitempty"`
	ToolIndex          []observedInjectionToolIndex   `json:"toolIndex,omitempty"`
}

// observedInjectionRunRef gives designers and devtools enough provenance to
// deep-link into the trace UI later while keeping this endpoint compact.
type observedInjectionRunRef struct {
	RunID      string `json:"runId"`
	TraceID    string `json:"traceId,omitempty"`
	SpanID     string `json:"spanId,omitempty"`
	PromptID   string `json:"promptId,omitempty"`
	ArtifactID string `json:"artifactId,omitempty"`
	ObservedAt string `json:"observedAt,omitempty"`
	State      string `json:"state,omitempty"`
}

// observedInjectionCount represents one counted runtime label. The generic shape
// is reused for states, inject targets, tool names, and cache statuses so the UI
// can render any of them as small ranked facets.
type observedInjectionCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// observedInjectionBranchCount tracks branch frequency and whether each branch
// led to inclusion. This supports conditionality views without exposing the
// runtime input values that selected a branch.
type observedInjectionBranchCount struct {
	Name          string `json:"name"`
	Count         int    `json:"count"`
	IncludedCount int    `json:"includedCount"`
	ExcludedCount int    `json:"excludedCount"`
}

// observedInjectionIndexMatch records how the runtime source id lines up with
// the current Project Index. It is intentionally descriptive rather than a lint:
// traces can be incomplete, stale, or from a different source revision.
type observedInjectionIndexMatch struct {
	Status               string   `json:"status"`
	DefinitionID         string   `json:"definitionId,omitempty"`
	DefinitionKind       string   `json:"definitionKind,omitempty"`
	PredictedByPromptIDs []string `json:"predictedByPromptIds,omitempty"`
	Reason               string   `json:"reason,omitempty"`
}

// observedInjectionToolIndex explains whether an observed injected tool was
// known to the authored index and, when possible, predicted for this source.
type observedInjectionToolIndex struct {
	Name         string `json:"name"`
	Status       string `json:"status"`
	DefinitionID string `json:"definitionId,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// observedInjectionDrift is a soft comparison finding between runtime evidence
// and the current authored index. Consumers should treat these as explainable
// review leads, not proof of a bug.
type observedInjectionDrift struct {
	Kind         string                    `json:"kind"`
	Severity     string                    `json:"severity"`
	Message      string                    `json:"message"`
	SourceID     string                    `json:"sourceId,omitempty"`
	DefinitionID string                    `json:"definitionId,omitempty"`
	ToolName     string                    `json:"toolName,omitempty"`
	PromptIDs    []string                  `json:"promptIds,omitempty"`
	RunRefs      []observedInjectionRunRef `json:"runRefs,omitempty"`
}

// observedPromptInput aggregates redacted prompt input-key previews. It keeps
// schema comparison at the key level so runtime validation views can explain
// missing or unexpected fields without exposing field values.
type observedPromptInput struct {
	PromptID           string                    `json:"promptId"`
	ObservedCount      int                       `json:"observedCount"`
	PassedCount        int                       `json:"passedCount"`
	FailedCount        int                       `json:"failedCount"`
	NotConfiguredCount int                       `json:"notConfiguredCount"`
	ValidationStatuses []observedInjectionCount  `json:"validationStatuses,omitempty"`
	ProvidedKeys       []observedInjectionCount  `json:"providedKeys,omitempty"`
	SchemaKeys         []observedInjectionCount  `json:"schemaKeys,omitempty"`
	RequiredKeys       []observedInjectionCount  `json:"requiredKeys,omitempty"`
	MissingKeys        []observedInjectionCount  `json:"missingKeys,omitempty"`
	UnexpectedKeys     []observedInjectionCount  `json:"unexpectedKeys,omitempty"`
	RunRefs            []observedInjectionRunRef `json:"runRefs,omitempty"`
}

type observedInjectionAccumulator struct {
	source observedInjectionSource

	promptIDs     map[string]bool
	states        map[string]int
	injects       map[string]int
	tools         map[string]int
	cacheStatuses map[string]int
	branches      map[string]*observedInjectionBranchCount
	runSeen       map[string]bool
}

type observedPromptInputAccumulator struct {
	input observedPromptInput

	validationStatuses map[string]int
	providedKeys       map[string]int
	schemaKeys         map[string]int
	requiredKeys       map[string]int
	missingKeys        map[string]int
	unexpectedKeys     map[string]int
	runSeen            map[string]bool
}

// observedInjectionReadModelFromObservability scans recent observability runs and
// aggregates `context.contribution` artifacts. It intentionally uses the artifact
// contract rather than raw span names so it can track contexts, injectables,
// memory, blackboards, tool-only contributions, and budget drops uniformly.
func observedInjectionReadModelFromObservability(ctx context.Context, obs *observability.Service, index store.IndexData, limit int) (observedInjectionReadModel, error) {
	model := observedInjectionReadModel{SchemaVersion: observedInjectionSchemaVersion}
	if obs == nil {
		return model, nil
	}

	if limit == 0 {
		limit = 250
	}
	runs, err := obs.RunsWithOptions(ctx, observability.RunListOptions{Limit: limit})
	if err != nil {
		return model, err
	}
	model.RunCount = len(runs)

	bySource := map[string]*observedInjectionAccumulator{}
	byInputPrompt := map[string]*observedPromptInputAccumulator{}
	for _, run := range runs {
		graph, err := obs.Graph(ctx, run.RunID)
		if err != nil {
			return model, err
		}
		spanPrompts := observedInjectionSpanPromptIndex(graph)
		runPromptID := observedFirstNonEmpty(graph.Run.PromptID, run.PromptID)

		for _, artifact := range graph.Artifacts {
			switch artifact.Kind {
			case "input":
				preview := rawMap(artifact.Preview)
				if stringValue(preview, "kind", "") != "prompt.input" {
					continue
				}
				observedInjectionAddPromptInput(byInputPrompt, preview, observedInjectionRunRef{
					RunID:      graph.Run.RunID,
					TraceID:    graph.Run.TraceID,
					SpanID:     artifact.SpanID,
					PromptID:   observedFirstNonEmpty(stringValue(preview, "promptId", ""), spanPrompts[artifact.SpanID], runPromptID),
					ArtifactID: artifact.ArtifactID,
					ObservedAt: artifact.CreatedAt,
				})
			case "context.contribution":
				preview := rawMap(artifact.Preview)
				if observedInjectionAddContribution(bySource, preview, observedInjectionRunRef{
					RunID:      graph.Run.RunID,
					TraceID:    graph.Run.TraceID,
					SpanID:     artifact.SpanID,
					PromptID:   observedFirstNonEmpty(spanPrompts[artifact.SpanID], runPromptID),
					ArtifactID: artifact.ArtifactID,
					ObservedAt: artifact.CreatedAt,
				}) {
					model.ContributionCount++
				}
			case "prompt.budget":
				for _, dropped := range observedInjectionDroppedBudgetEntries(rawMap(artifact.Preview)) {
					if observedInjectionAddContribution(bySource, dropped, observedInjectionRunRef{
						RunID:      graph.Run.RunID,
						TraceID:    graph.Run.TraceID,
						SpanID:     artifact.SpanID,
						PromptID:   observedFirstNonEmpty(spanPrompts[artifact.SpanID], runPromptID),
						ArtifactID: artifact.ArtifactID,
						ObservedAt: artifact.CreatedAt,
					}) {
						model.ContributionCount++
					}
				}
			}
		}
	}

	model.Sources = observedInjectionSources(bySource)
	model.Inputs = observedPromptInputs(byInputPrompt)
	observedInjectionApplyIndexEvidence(&model, index)
	return model, nil
}

// observedInjectionSpanPromptIndex records the nearest prompt id known on each
// span. Most contribution artifacts are produced inside prompt/generation spans;
// when they are not, the caller still falls back to the run-level prompt id.
func observedInjectionSpanPromptIndex(graph observability.Graph) map[string]string {
	prompts := make(map[string]string, len(graph.Spans))
	for _, span := range graph.Spans {
		if span.PromptID != "" {
			prompts[span.SpanID] = span.PromptID
			continue
		}
		if promptID := stringMetric(rawMap(span.Attributes), "promptId", "promptID"); promptID != "" {
			prompts[span.SpanID] = promptID
		}
	}
	return prompts
}

// observedInjectionDroppedBudgetEntries extracts dropped contribution previews
// from prompt budget artifacts. These entries are not active injection, but they
// are runtime evidence that the resolver considered a source and skipped it for
// budget reasons.
func observedInjectionDroppedBudgetEntries(preview map[string]any) []map[string]any {
	rawDropped, ok := preview["dropped"].([]any)
	if !ok {
		return nil
	}
	entries := make([]map[string]any, 0, len(rawDropped))
	for _, rawEntry := range rawDropped {
		entry, ok := rawEntry.(map[string]any)
		if !ok {
			continue
		}
		if stringValue(entry, "state", "") == "" {
			entry["state"] = "dropped-budget"
		}
		if _, ok := entry["included"]; !ok {
			entry["included"] = false
		}
		entries = append(entries, entry)
	}
	return entries
}

// observedInjectionAddContribution merges a single contribution preview into the
// aggregate for its sourceId. It returns false when the preview is malformed or
// does not identify a source.
func observedInjectionAddContribution(bySource map[string]*observedInjectionAccumulator, preview map[string]any, ref observedInjectionRunRef) bool {
	sourceID := stringValue(preview, "sourceId", "")
	if sourceID == "" {
		sourceID = stringValue(preview, "source", "")
	}
	if sourceID == "" {
		return false
	}

	acc := bySource[sourceID]
	if acc == nil {
		definitionID, definitionKind := observedInjectionDefinitionIdentity(sourceID)
		acc = &observedInjectionAccumulator{
			source: observedInjectionSource{
				ID:             sourceID,
				SourceID:       sourceID,
				DefinitionID:   definitionID,
				DefinitionKind: definitionKind,
			},
			promptIDs:     map[string]bool{},
			states:        map[string]int{},
			injects:       map[string]int{},
			tools:         map[string]int{},
			cacheStatuses: map[string]int{},
			branches:      map[string]*observedInjectionBranchCount{},
			runSeen:       map[string]bool{},
		}
		bySource[sourceID] = acc
	}

	state := observedFirstNonEmpty(stringValue(preview, "state", ""), "unknown")
	included := boolValue(preview, "included", state == "active")
	branch := stringValue(preview, "branch", "")

	acc.source.ObservedCount++
	if included {
		acc.source.IncludedCount++
	} else {
		acc.source.ExcludedCount++
	}
	if state == "dropped-budget" {
		acc.source.DroppedBudgetCount++
	}
	if kind := stringValue(preview, "injectableKind", ""); kind != "" {
		acc.source.InjectableKind = kind
	}
	if ref.PromptID != "" {
		acc.promptIDs[ref.PromptID] = true
	}
	acc.states[state]++
	if cacheStatus := stringValue(preview, "cacheStatus", ""); cacheStatus != "" {
		acc.cacheStatuses[cacheStatus]++
	}
	for _, name := range stringListValue(preview["injects"]) {
		acc.injects[name]++
	}
	for _, name := range stringListValue(preview["injectedTools"]) {
		acc.tools[name]++
	}
	if branch != "" {
		branchCount := acc.branches[branch]
		if branchCount == nil {
			branchCount = &observedInjectionBranchCount{Name: branch}
			acc.branches[branch] = branchCount
		}
		branchCount.Count++
		if included {
			branchCount.IncludedCount++
		} else {
			branchCount.ExcludedCount++
		}
	}

	ref.State = state
	runKey := ref.RunID + "\x00" + ref.SpanID + "\x00" + ref.ArtifactID + "\x00" + state
	if !acc.runSeen[runKey] && len(acc.source.RunRefs) < 12 {
		acc.source.RunRefs = append(acc.source.RunRefs, ref)
		acc.runSeen[runKey] = true
	}
	return true
}

// observedInjectionSources finalizes sorted, deterministic slices for JSON
// callers. Counts sort by descending frequency and then name for stable diffs.
func observedInjectionSources(bySource map[string]*observedInjectionAccumulator) []observedInjectionSource {
	sources := make([]observedInjectionSource, 0, len(bySource))
	for _, acc := range bySource {
		source := acc.source
		source.PromptIDs = sortedKeys(acc.promptIDs)
		source.States = observedInjectionCounts(acc.states)
		source.Injects = observedInjectionCounts(acc.injects)
		source.Tools = observedInjectionCounts(acc.tools)
		source.CacheStatuses = observedInjectionCounts(acc.cacheStatuses)
		source.Branches = observedInjectionBranches(acc.branches)
		sources = append(sources, source)
	}
	sort.Slice(sources, func(i, j int) bool {
		if sources[i].ObservedCount != sources[j].ObservedCount {
			return sources[i].ObservedCount > sources[j].ObservedCount
		}
		return sources[i].SourceID < sources[j].SourceID
	})
	return sources
}

// observedInjectionAddPromptInput folds one redacted prompt-input artifact into
// per-prompt counters. It ignores malformed previews because older traces may
// use the generic `input` artifact kind for unrelated payloads.
func observedInjectionAddPromptInput(byPrompt map[string]*observedPromptInputAccumulator, preview map[string]any, ref observedInjectionRunRef) bool {
	promptID := observedFirstNonEmpty(stringValue(preview, "promptId", ""), ref.PromptID, "unknown")
	status := observedFirstNonEmpty(stringValue(preview, "validationStatus", ""), "unknown")
	acc := byPrompt[promptID]
	if acc == nil {
		acc = &observedPromptInputAccumulator{
			input:              observedPromptInput{PromptID: promptID},
			validationStatuses: map[string]int{},
			providedKeys:       map[string]int{},
			schemaKeys:         map[string]int{},
			requiredKeys:       map[string]int{},
			missingKeys:        map[string]int{},
			unexpectedKeys:     map[string]int{},
			runSeen:            map[string]bool{},
		}
		byPrompt[promptID] = acc
	}
	acc.input.ObservedCount++
	switch status {
	case "passed":
		acc.input.PassedCount++
	case "failed":
		acc.input.FailedCount++
	case "not-configured":
		acc.input.NotConfiguredCount++
	}
	acc.validationStatuses[status]++
	for _, key := range stringListValue(preview["providedKeys"]) {
		acc.providedKeys[key]++
	}
	for _, key := range stringListValue(preview["schemaKeys"]) {
		acc.schemaKeys[key]++
	}
	for _, key := range stringListValue(preview["requiredKeys"]) {
		acc.requiredKeys[key]++
	}
	for _, key := range stringListValue(preview["missingKeys"]) {
		acc.missingKeys[key]++
	}
	for _, key := range stringListValue(preview["unexpectedKeys"]) {
		acc.unexpectedKeys[key]++
	}
	ref.PromptID = promptID
	ref.State = status
	runKey := ref.RunID + "\x00" + ref.SpanID + "\x00" + ref.ArtifactID + "\x00" + status
	if !acc.runSeen[runKey] && len(acc.input.RunRefs) < 12 {
		acc.input.RunRefs = append(acc.input.RunRefs, ref)
		acc.runSeen[runKey] = true
	}
	return true
}

func observedPromptInputs(byPrompt map[string]*observedPromptInputAccumulator) []observedPromptInput {
	inputs := make([]observedPromptInput, 0, len(byPrompt))
	for _, acc := range byPrompt {
		input := acc.input
		input.ValidationStatuses = observedInjectionCounts(acc.validationStatuses)
		input.ProvidedKeys = observedInjectionCounts(acc.providedKeys)
		input.SchemaKeys = observedInjectionCounts(acc.schemaKeys)
		input.RequiredKeys = observedInjectionCounts(acc.requiredKeys)
		input.MissingKeys = observedInjectionCounts(acc.missingKeys)
		input.UnexpectedKeys = observedInjectionCounts(acc.unexpectedKeys)
		inputs = append(inputs, input)
	}
	sort.Slice(inputs, func(i, j int) bool {
		if inputs[i].ObservedCount != inputs[j].ObservedCount {
			return inputs[i].ObservedCount > inputs[j].ObservedCount
		}
		return inputs[i].PromptID < inputs[j].PromptID
	})
	return inputs
}

// observedInjectionApplyIndexEvidence compares runtime-observed contributions
// with the current authored index. It only adds explanatory metadata; it never
// removes runtime observations because stale traces and stale source snapshots
// are both valid local-dev states.
func observedInjectionApplyIndexEvidence(model *observedInjectionReadModel, index store.IndexData) {
	if model == nil || len(model.Sources) == 0 {
		return
	}
	idx := newObservedInjectionIndex(index)
	for sourceIndex := range model.Sources {
		source := &model.Sources[sourceIndex]
		source.IndexMatch = idx.sourceMatch(*source)
		source.ToolIndex = idx.toolMatches(*source)
		model.Drift = append(model.Drift, idx.driftForSource(*source)...)
	}
	sort.Slice(model.Drift, func(i, j int) bool {
		if model.Drift[i].Severity != model.Drift[j].Severity {
			return model.Drift[i].Severity > model.Drift[j].Severity
		}
		if model.Drift[i].Kind != model.Drift[j].Kind {
			return model.Drift[i].Kind < model.Drift[j].Kind
		}
		if model.Drift[i].SourceID != model.Drift[j].SourceID {
			return model.Drift[i].SourceID < model.Drift[j].SourceID
		}
		return model.Drift[i].ToolName < model.Drift[j].ToolName
	})
}

type observedInjectionIndex struct {
	definitionsByID map[string]store.ProjectDefinition
	toolIDByName    map[string]string
	sourceTools     map[string]map[string]bool
	adjacency       map[string][]string
	promptIDByName  map[string]string
}

func newObservedInjectionIndex(index store.IndexData) observedInjectionIndex {
	idx := observedInjectionIndex{
		definitionsByID: map[string]store.ProjectDefinition{},
		toolIDByName:    map[string]string{},
		sourceTools:     map[string]map[string]bool{},
		adjacency:       map[string][]string{},
		promptIDByName:  map[string]string{},
	}
	for _, definition := range index.Definitions {
		idx.definitionsByID[definition.ID] = definition
		if definition.Kind == "prompt" {
			idx.promptIDByName[definition.Name] = definition.ID
		}
		if definition.Kind == "tool" {
			idx.toolIDByName[definition.Name] = definition.ID
			idx.toolIDByName[definition.ID] = definition.ID
			if strings.HasPrefix(definition.ID, "tool:") {
				idx.toolIDByName[strings.TrimPrefix(definition.ID, "tool:")] = definition.ID
			}
		}
	}
	for _, relation := range index.Relations {
		if relation.From != "" && relation.To != "" {
			idx.adjacency[relation.From] = append(idx.adjacency[relation.From], relation.To)
		}
		if strings.Contains(relation.Type, "uses_tool") {
			if tool, ok := idx.definitionsByID[relation.To]; ok && tool.Kind == "tool" {
				idx.addSourceTool(relation.From, tool.Name)
				idx.addSourceTool(relation.From, tool.ID)
				if strings.HasPrefix(tool.ID, "tool:") {
					idx.addSourceTool(relation.From, strings.TrimPrefix(tool.ID, "tool:"))
				}
			}
		}
	}
	for _, definition := range index.Definitions {
		for _, name := range observedInjectionFactToolNames(definition.Metadata) {
			idx.addSourceTool(definition.ID, name)
		}
	}
	return idx
}

func (idx observedInjectionIndex) sourceMatch(source observedInjectionSource) *observedInjectionIndexMatch {
	match := &observedInjectionIndexMatch{Status: "unknown"}
	if source.DefinitionID == "" {
		match.Status = "runtime-only"
		match.Reason = "runtime source id does not map to a known Project Index definition prefix"
		return match
	}
	definition, indexed := idx.definitionsByID[source.DefinitionID]
	if !indexed {
		match.Status = "not-indexed"
		match.DefinitionID = source.DefinitionID
		match.DefinitionKind = source.DefinitionKind
		match.Reason = "runtime source id maps to an authored definition id that is not present in the current Project Index"
		return match
	}
	match.Status = "indexed"
	match.DefinitionID = definition.ID
	match.DefinitionKind = definition.Kind
	for _, promptID := range source.PromptIDs {
		promptDefinitionID := idx.promptDefinitionID(promptID)
		if promptDefinitionID == "" {
			continue
		}
		if promptDefinitionID == definition.ID || idx.reaches(promptDefinitionID, definition.ID) {
			match.PredictedByPromptIDs = append(match.PredictedByPromptIDs, promptID)
		}
	}
	if len(source.PromptIDs) > 0 && len(match.PredictedByPromptIDs) == 0 {
		match.Status = "indexed-not-predicted-for-prompt"
		match.Reason = "runtime observed this source for prompts that the current authored relation graph does not connect to it"
	}
	return match
}

func (idx observedInjectionIndex) toolMatches(source observedInjectionSource) []observedInjectionToolIndex {
	if len(source.Tools) == 0 {
		return nil
	}
	matches := make([]observedInjectionToolIndex, 0, len(source.Tools))
	predictedTools := idx.sourceTools[source.DefinitionID]
	for _, tool := range source.Tools {
		match := observedInjectionToolIndex{Name: tool.Name}
		if toolDefinitionID := idx.toolIDByName[tool.Name]; toolDefinitionID != "" {
			match.DefinitionID = toolDefinitionID
			if predictedTools[tool.Name] || predictedTools[toolDefinitionID] || predictedTools[strings.TrimPrefix(toolDefinitionID, "tool:")] {
				match.Status = "predicted"
			} else {
				match.Status = "indexed-not-predicted-for-source"
				match.Reason = "tool exists in the Project Index, but the current source definition does not statically expose it"
			}
		} else {
			match.Status = "not-indexed"
			match.Reason = "runtime observed an injected tool name that is not present as a Project Index tool definition"
		}
		matches = append(matches, match)
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Status != matches[j].Status {
			return matches[i].Status < matches[j].Status
		}
		return matches[i].Name < matches[j].Name
	})
	return matches
}

func (idx observedInjectionIndex) driftForSource(source observedInjectionSource) []observedInjectionDrift {
	var drift []observedInjectionDrift
	if source.IndexMatch != nil {
		switch source.IndexMatch.Status {
		case "not-indexed":
			drift = append(drift, observedInjectionDrift{
				Kind:         "runtime.observed_source_not_indexed",
				Severity:     "warning",
				Message:      "Runtime observed an injection source that is not present in the current Project Index.",
				SourceID:     source.SourceID,
				DefinitionID: source.DefinitionID,
				PromptIDs:    source.PromptIDs,
				RunRefs:      source.RunRefs,
			})
		case "indexed-not-predicted-for-prompt":
			drift = append(drift, observedInjectionDrift{
				Kind:         "runtime.observed_source_not_predicted_for_prompt",
				Severity:     "info",
				Message:      "Runtime observed this source for a prompt that the current authored relation graph does not connect to it.",
				SourceID:     source.SourceID,
				DefinitionID: source.DefinitionID,
				PromptIDs:    source.PromptIDs,
				RunRefs:      source.RunRefs,
			})
		}
	}
	for _, tool := range source.ToolIndex {
		switch tool.Status {
		case "not-indexed":
			drift = append(drift, observedInjectionDrift{
				Kind:         "runtime.observed_tool_not_indexed",
				Severity:     "warning",
				Message:      "Runtime observed an injected tool name that is not present in the current Project Index.",
				SourceID:     source.SourceID,
				DefinitionID: source.DefinitionID,
				ToolName:     tool.Name,
				PromptIDs:    source.PromptIDs,
				RunRefs:      source.RunRefs,
			})
		case "indexed-not-predicted-for-source":
			drift = append(drift, observedInjectionDrift{
				Kind:         "runtime.observed_tool_not_predicted_for_source",
				Severity:     "info",
				Message:      "Runtime observed this source injecting a tool that the current source facts do not statically expose.",
				SourceID:     source.SourceID,
				DefinitionID: source.DefinitionID,
				ToolName:     tool.Name,
				PromptIDs:    source.PromptIDs,
				RunRefs:      source.RunRefs,
			})
		}
	}
	return drift
}

func (idx observedInjectionIndex) promptDefinitionID(promptID string) string {
	if promptID == "" {
		return ""
	}
	if _, ok := idx.definitionsByID[promptID]; ok {
		return promptID
	}
	candidate := "prompt:" + promptID
	if _, ok := idx.definitionsByID[candidate]; ok {
		return candidate
	}
	return idx.promptIDByName[promptID]
}

func (idx observedInjectionIndex) reaches(from string, to string) bool {
	if from == "" || to == "" {
		return false
	}
	seen := map[string]bool{from: true}
	queue := []string{from}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, next := range idx.adjacency[current] {
			if next == to {
				return true
			}
			if seen[next] {
				continue
			}
			seen[next] = true
			queue = append(queue, next)
		}
	}
	return false
}

func (idx observedInjectionIndex) addSourceTool(sourceID string, toolName string) {
	if sourceID == "" || toolName == "" {
		return
	}
	if idx.sourceTools[sourceID] == nil {
		idx.sourceTools[sourceID] = map[string]bool{}
	}
	idx.sourceTools[sourceID][toolName] = true
}

func observedInjectionFactToolNames(raw json.RawMessage) []string {
	metadata := observedInjectionMetadata(raw)
	if metadata == nil {
		return nil
	}
	facts, ok := metadata["facts"].(map[string]any)
	if !ok {
		return nil
	}
	tools, ok := facts["tools"].(map[string]any)
	if !ok {
		return nil
	}
	return stringListValue(tools["names"])
}

func observedInjectionMetadata(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil
	}
	return metadata
}

// observedInjectionCounts converts a sparse counter map into a deterministic
// ranked facet list, omitting empty names that would not be actionable in UI.
func observedInjectionCounts(counts map[string]int) []observedInjectionCount {
	out := make([]observedInjectionCount, 0, len(counts))
	for name, count := range counts {
		if name == "" || count <= 0 {
			continue
		}
		out = append(out, observedInjectionCount{Name: name, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// observedInjectionBranches converts mutable branch counters into sorted value
// objects suitable for JSON encoding and snapshot tests.
func observedInjectionBranches(counts map[string]*observedInjectionBranchCount) []observedInjectionBranchCount {
	out := make([]observedInjectionBranchCount, 0, len(counts))
	for _, count := range counts {
		if count.Name == "" || count.Count <= 0 {
			continue
		}
		out = append(out, *count)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// observedInjectionDefinitionIdentity maps runtime source ids back to Project
// Index definition ids when the prefix is one of the known authored kinds.
func observedInjectionDefinitionIdentity(sourceID string) (string, string) {
	prefix, name, ok := strings.Cut(sourceID, ":")
	if !ok || name == "" {
		return "", ""
	}
	switch prefix {
	case "prompt", "context", "injectable", "memory", "blackboard", "workspace":
		return sourceID, prefix
	default:
		return "", prefix
	}
}

// observedFirstNonEmpty returns the first non-empty candidate. The helper stays
// local because this read model deliberately avoids depending on package-private
// observability projection utilities.
func observedFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// stringListValue normalizes JSON-decoded and raw string-list values from
// contribution previews. It ignores non-string entries rather than failing the
// whole contribution because runtime artifacts should be best-effort evidence.
func stringListValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && text != "" {
				out = append(out, text)
			}
		}
		return out
	case json.RawMessage:
		var values []string
		if err := json.Unmarshal(typed, &values); err == nil {
			return values
		}
	}
	return nil
}
