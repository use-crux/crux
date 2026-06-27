package readmodel

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

var indexSafeIDPattern = regexp.MustCompile(`[^a-zA-Z0-9_.:-]+`)

type indexQualityBuilder struct {
	values map[string]*store.IndexQuality
}

func newIndexQualityBuilder() *indexQualityBuilder {
	return &indexQualityBuilder{values: make(map[string]*store.IndexQuality)}
}

func (b *indexQualityBuilder) quality(defID string) *store.IndexQuality {
	if defID == "" {
		return nil
	}
	q := b.values[defID]
	if q == nil {
		q = &store.IndexQuality{}
		b.values[defID] = q
	}
	return q
}

func (b *indexQualityBuilder) addEval(defID, evalID string) {
	q := b.quality(defID)
	if q == nil {
		return
	}
	q.EvalIDs = appendUniqueString(q.EvalIDs, evalID)
}

func (b *indexQualityBuilder) addSuite(defID, suiteID string) {
	q := b.quality(defID)
	if q == nil {
		return
	}
	q.SuiteIDs = appendUniqueString(q.SuiteIDs, suiteID)
}

func (b *indexQualityBuilder) addEvalRun(defID string, run store.EvalRun) {
	q := b.quality(defID)
	if q == nil {
		return
	}
	if containsString(q.RunIDs, run.EvalID) {
		return
	}
	q.RunIDs = appendUniqueString(q.RunIDs, run.EvalID)
	q.RunCount++
	q.CaseCount += run.TotalCases
	q.LastStatus = run.Status
	if q.LastRunAt == 0 || run.StartedAt > q.LastRunAt {
		q.LastRunAt = run.StartedAt
		q.LastRunID = run.EvalID
	}
	switch run.Status {
	case "completed":
		q.CompletedRunCount++
	case "running":
		q.RunningRunCount++
	case "error", "failed":
		q.FailedRunCount++
	}
	for _, c := range run.CompletedCases {
		if c.TraceID != "" {
			q.TraceIDs = appendUniqueString(q.TraceIDs, c.TraceID)
		}
	}
	rate, ok := evalRunPassRate(run.CompletedCases)
	setPassRate(q, rate, ok)
}

func (b *indexQualityBuilder) addRagEvalRun(defID string, run store.RagEvalRun) {
	q := b.quality(defID)
	if q == nil {
		return
	}
	if containsString(q.RunIDs, run.EvalID) {
		return
	}
	q.RunIDs = appendUniqueString(q.RunIDs, run.EvalID)
	q.RunCount++
	q.CaseCount += run.CaseCount
	q.LastStatus = run.Status
	if q.LastRunAt == 0 || run.StartedAt > q.LastRunAt {
		q.LastRunAt = run.StartedAt
		q.LastRunID = run.EvalID
	}
	switch run.Status {
	case "completed":
		q.CompletedRunCount++
	case "running":
		q.RunningRunCount++
	case "error", "failed":
		q.FailedRunCount++
	}
	for _, c := range run.CompletedCases {
		traceID := traceIDFromRawJSON(c.Trace)
		if traceID != "" {
			q.TraceIDs = appendUniqueString(q.TraceIDs, traceID)
		}
	}
	rate, ok := ragEvalRunPassRate(run.CompletedCases)
	setPassRate(q, rate, ok)
}

func (b *indexQualityBuilder) addFlowRun(defID string, run store.FlowRun) {
	q := b.quality(defID)
	if q == nil {
		return
	}
	if containsString(q.RunIDs, run.FlowID) {
		return
	}
	q.RunIDs = appendUniqueString(q.RunIDs, run.FlowID)
	q.RunCount++
	q.CaseCount += run.TotalCases
	q.LastStatus = run.Status
	if q.LastRunAt == 0 || run.StartedAt > q.LastRunAt {
		q.LastRunAt = run.StartedAt
		q.LastRunID = run.FlowID
	}
	switch run.Status {
	case "completed":
		q.CompletedRunCount++
	case "running":
		q.RunningRunCount++
	case "error", "failed":
		q.FailedRunCount++
	}
	rate, ok := flowRunPassRate(run.CompletedCases)
	setPassRate(q, rate, ok)
}

func enrichRuns(index store.IndexData, evals []store.EvalRun, rags []store.RagEvalRun, flows []store.FlowRun) store.IndexData {
	definitions := append([]store.ProjectDefinition(nil), index.Definitions...)
	relations := append([]store.ProjectRelation(nil), index.Relations...)
	index.Definitions = definitions
	index.Relations = relations

	if len(definitions) == 0 {
		return index
	}

	builder := newIndexQualityBuilder()
	promptDefinitionIDsByPromptID := map[string][]string{}
	evalPromptTargetsByEvalDefinitionID := map[string][]string{}

	for _, def := range definitions {
		switch def.Kind {
		case "prompt":
			promptID := strings.TrimPrefix(def.ID, "prompt:")
			if promptID != "" {
				promptDefinitionIDsByPromptID[promptID] = append(promptDefinitionIDsByPromptID[promptID], def.ID)
			}
		case "eval.prompt":
			if promptID := stringMetadata(def.Metadata, "promptId"); promptID != "" {
				evalPromptTargetsByEvalDefinitionID[def.ID] = append(evalPromptTargetsByEvalDefinitionID[def.ID], "prompt:"+safeIndexID(promptID))
			}
		}
	}

	for _, rel := range relations {
		if rel.Type == "eval.targets_prompt" {
			evalPromptTargetsByEvalDefinitionID[rel.From] = append(evalPromptTargetsByEvalDefinitionID[rel.From], rel.To)
		}
	}

	for _, run := range evals {
		evalDefIDs := candidateEvalDefinitionIDs("eval.prompt", run.EvalID)
		for _, defID := range evalDefIDs {
			builder.addEvalRun(defID, run)
		}
		if run.PromptID != nil && *run.PromptID != "" {
			for _, promptDefID := range promptDefinitionIDsByPromptID[*run.PromptID] {
				builder.addEval(promptDefID, run.EvalID)
				builder.addEvalRun(promptDefID, run)
			}
			builder.addEval("prompt:"+safeIndexID(*run.PromptID), run.EvalID)
			builder.addEvalRun("prompt:"+safeIndexID(*run.PromptID), run)
		}
		for _, evalDefID := range evalDefIDs {
			for _, promptDefID := range evalPromptTargetsByEvalDefinitionID[evalDefID] {
				builder.addEval(promptDefID, run.EvalID)
				builder.addEvalRun(promptDefID, run)
			}
		}
	}

	for _, run := range rags {
		evalDefID := "eval.rag:" + safeIndexID(run.EvalID)
		builder.addRagEvalRun(evalDefID, run)
		if run.SuiteID != "" {
			suiteDefID := "suite:" + safeIndexID(run.SuiteID)
			builder.addSuite(evalDefID, run.SuiteID)
			builder.addSuite(suiteDefID, run.SuiteID)
			builder.addEval(suiteDefID, run.EvalID)
			builder.addRagEvalRun(suiteDefID, run)
		}
	}

	for _, run := range flows {
		builder.addFlowRun("eval.flow:"+safeIndexID(run.FlowID), run)
		builder.addFlowRun("flow:"+safeIndexID(run.FlowID), run)
	}

	for i := range definitions {
		if q := builder.values[definitions[i].ID]; q != nil && !indexQualityIsEmpty(q) {
			definitions[i].Quality = q
		}
	}

	return index
}

func indexQualityIsEmpty(q *store.IndexQuality) bool {
	return q.RunCount == 0 &&
		q.CompletedRunCount == 0 &&
		q.FailedRunCount == 0 &&
		q.RunningRunCount == 0 &&
		q.LastRunID == "" &&
		q.LastRunAt == 0 &&
		q.LastStatus == "" &&
		q.CaseCount == 0 &&
		q.ExperimentCount == 0 &&
		q.BaselineCount == 0 &&
		q.ComparisonCount == 0 &&
		q.FeedbackCount == 0 &&
		q.CassetteCount == 0 &&
		q.PassRate == nil &&
		q.Drift == nil &&
		q.CurrentFingerprint == "" &&
		q.BaselineFingerprint == "" &&
		q.ChangedSinceBaseline == nil &&
		len(q.AffectedEvalIDs) == 0 &&
		len(q.AffectedSuiteIDs) == 0 &&
		len(q.EvalIDs) == 0 &&
		len(q.SuiteIDs) == 0 &&
		len(q.ExperimentIDs) == 0 &&
		len(q.BaselineIDs) == 0 &&
		len(q.ComparisonIDs) == 0 &&
		len(q.FeedbackIDs) == 0 &&
		len(q.CassettePaths) == 0 &&
		len(q.RunIDs) == 0 &&
		len(q.TraceIDs) == 0
}

func candidateEvalDefinitionIDs(prefix, evalID string) []string {
	safe := safeIndexID(evalID)
	out := []string{prefix + ":" + safe}
	if evalID != safe {
		out = append(out, prefix+":"+evalID)
	}
	return out
}

func safeIndexID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	safe := indexSafeIDPattern.ReplaceAllString(trimmed, "-")
	safe = strings.Trim(safe, "-")
	if safe == "" {
		return trimmed
	}
	return safe
}

func appendUniqueString(values []string, value string) []string {
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

func containsString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func stringMetadata(raw json.RawMessage, key string) string {
	if len(raw) == 0 {
		return ""
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	value, _ := data[key].(string)
	return value
}

func traceIDFromRawJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return ""
	}
	for _, key := range []string{"traceId", "traceID", "id"} {
		if value, ok := data[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func evalRunPassRate(cases []store.EvalCaseData) (float64, bool) {
	if len(cases) == 0 {
		return 0, false
	}
	passed := 0
	for _, c := range cases {
		if c.Passed {
			passed++
		}
	}
	return float64(passed) / float64(len(cases)), true
}

func ragEvalRunPassRate(cases []store.RagEvalCaseData) (float64, bool) {
	if len(cases) == 0 {
		return 0, false
	}
	passed := 0
	for _, c := range cases {
		status := strings.ToLower(c.Status)
		if (status == "ok" || status == "pass" || status == "passed" || status == "completed") && len(c.FailureTypes) == 0 && c.Error == "" {
			passed++
		}
	}
	return float64(passed) / float64(len(cases)), true
}

func flowRunPassRate(cases []store.FlowCaseData) (float64, bool) {
	if len(cases) == 0 {
		return 0, false
	}
	passed := 0
	for _, c := range cases {
		if c.Passed {
			passed++
		}
	}
	return float64(passed) / float64(len(cases)), true
}

func setPassRate(q *store.IndexQuality, rate float64, ok bool) {
	if !ok {
		return
	}
	if q.PassRate == nil {
		q.PassRate = &rate
		return
	}
	combined := (*q.PassRate + rate) / 2
	q.PassRate = &combined
}
