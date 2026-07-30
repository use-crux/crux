package devtools

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"

	_ "modernc.org/sqlite"
)

func TestServiceStatsRoutesPreferObservability(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../../core/src/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(fixture, &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), inspect.NewService(store.NewStore(), t.TempDir())).WithObservability(obs)

	stats := service.Stats(ctx)
	if stats.TotalExecutions != 1 || stats.SuccessCount != 1 || stats.TotalTokens != 60 || stats.TotalCost != 0.00042 {
		t.Fatalf("stats = %#v", stats)
	}

	usage := service.PromptUsage(ctx)
	if usage["support.reply"].Count != 1 || usage["support.reply"].TotalCost != 0.00042 {
		t.Fatalf("prompt usage = %#v", usage)
	}

	sessions := service.Sessions(ctx)
	if len(sessions) != 1 || sessions[0].SessionID != "default" || sessions[0].TraceCount != 1 {
		t.Fatalf("sessions = %#v", sessions)
	}
}

func TestObservabilityStatsExcludeIncompleteFromExecutionDenominators(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Minute).UTC().Format(time.RFC3339Nano)
	fresh := time.Now().UTC().Format(time.RFC3339Nano)
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"schemaVersion":5,"records":[
		{"schemaVersion":5,"recordId":"success-start","type":"run:start","runId":"success","operationId":"success","segmentId":"success-segment","segmentSeq":1,"name":"success","rootPrimitive":"agent.run","startedAt":"`+old+`","status":"running"},
		{"schemaVersion":5,"recordId":"success-end","type":"run:end","runId":"success","operationId":"success","segmentId":"success-segment","segmentSeq":2,"endedAt":"`+old+`","status":"ok"},
		{"schemaVersion":5,"recordId":"error-start","type":"run:start","runId":"error","operationId":"error","segmentId":"error-segment","segmentSeq":1,"name":"error","rootPrimitive":"agent.run","startedAt":"`+old+`","status":"running"},
		{"schemaVersion":5,"recordId":"error-end","type":"run:end","runId":"error","operationId":"error","segmentId":"error-segment","segmentSeq":2,"endedAt":"`+old+`","status":"error"},
		{"schemaVersion":5,"recordId":"running-start","type":"run:start","runId":"running","operationId":"running","segmentId":"running-segment","segmentSeq":1,"name":"running","rootPrimitive":"agent.run","startedAt":"`+fresh+`","status":"running"},
		{"schemaVersion":5,"recordId":"incomplete-start","type":"run:start","runId":"incomplete","operationId":"incomplete","segmentId":"incomplete-segment","segmentSeq":1,"name":"incomplete","rootPrimitive":"agent.run","startedAt":"`+old+`","status":"running"}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE runs
		SET total_input_tokens = 400, total_output_tokens = 600, total_cost_usd = 9
		WHERE run_id = 'incomplete'
	`); err != nil {
		t.Fatal(err)
	}

	stats := observabilityStats(ctx, obs)
	if stats.TotalExecutions != 3 || stats.SuccessCount != 1 || stats.ErrorCount != 1 || stats.RunningCount != 1 {
		t.Fatalf("stats = %#v, want total=3 success=1 error=1 running=1", stats)
	}
	if stats.ErrorRate != 1.0/3.0 {
		t.Fatalf("error rate = %v, want %v", stats.ErrorRate, 1.0/3.0)
	}
	if stats.TotalCost != 0 || stats.TotalTokens != 0 || stats.AvgCost != 0 {
		t.Fatalf("usage = cost:%v tokens:%d avg:%v, want incomplete usage excluded", stats.TotalCost, stats.TotalTokens, stats.AvgCost)
	}
}

func TestObservedInjectionReadModelUsesContextContributionArtifacts(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	obs, err := observability.NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../../core/src/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(fixture, &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), inspect.NewService(store.NewStore(), t.TempDir())).WithObservability(obs)
	value, err := service.ObservedInjection(ctx, 250)
	if err != nil {
		t.Fatalf("observed injection: %v", err)
	}
	model := value.(observedInjectionReadModel)
	if model.SchemaVersion != observedInjectionSchemaVersion || model.RunCount != 1 || model.ContributionCount != 2 {
		t.Fatalf("observed injection summary = %#v", model)
	}

	refundPolicy := observedInjectionSourceByID(model.Sources, "context:refund-policy")
	if refundPolicy == nil {
		t.Fatalf("missing context:refund-policy in %#v", model.Sources)
	}
	if refundPolicy.DefinitionID != "context:refund-policy" || refundPolicy.DefinitionKind != "context" || refundPolicy.IncludedCount != 1 {
		t.Fatalf("refund policy source = %#v", refundPolicy)
	}
	if !observedInjectionHasCount(refundPolicy.Injects, "system", 1) || !observedInjectionHasCount(refundPolicy.States, "active", 1) {
		t.Fatalf("refund policy counts = %#v", refundPolicy)
	}
	if len(refundPolicy.PromptIDs) != 1 || refundPolicy.PromptIDs[0] != "support.reply" {
		t.Fatalf("refund policy prompt ids = %#v", refundPolicy.PromptIDs)
	}

	verbosePolicy := observedInjectionSourceByID(model.Sources, "context:verbose-policy")
	if verbosePolicy == nil {
		t.Fatalf("missing context:verbose-policy in %#v", model.Sources)
	}
	if verbosePolicy.DroppedBudgetCount != 1 || verbosePolicy.IncludedCount != 0 || verbosePolicy.ExcludedCount != 1 {
		t.Fatalf("verbose policy source = %#v", verbosePolicy)
	}
	if !observedInjectionHasCount(verbosePolicy.States, "dropped-budget", 1) {
		t.Fatalf("verbose policy states = %#v", verbosePolicy.States)
	}
}

func TestObservedInjectionReadModelAggregatesBranchesAndTools(t *testing.T) {
	bySource := map[string]*observedInjectionAccumulator{}
	ok := observedInjectionAddContribution(bySource, map[string]any{
		"sourceId":       "injectable:search",
		"state":          "active",
		"included":       true,
		"injectableKind": "injectable",
		"branch":         "research",
		"injects":        []any{"tools"},
		"injectedTools":  []any{"searchWeb", "readMemory"},
	}, observedInjectionRunRef{RunID: "run_1", SpanID: "span_1", PromptID: "brief.write", ArtifactID: "artifact_1"})
	if !ok {
		t.Fatal("expected contribution to be accepted")
	}
	ok = observedInjectionAddContribution(bySource, map[string]any{
		"sourceId": "injectable:search",
		"state":    "checked-not-included",
		"included": false,
		"branch":   "default",
	}, observedInjectionRunRef{RunID: "run_1", SpanID: "span_2", PromptID: "brief.write", ArtifactID: "artifact_2"})
	if !ok {
		t.Fatal("expected excluded contribution to be accepted")
	}

	sources := observedInjectionSources(bySource)
	if len(sources) != 1 {
		t.Fatalf("sources = %#v", sources)
	}
	source := sources[0]
	if source.DefinitionID != "injectable:search" || source.DefinitionKind != "injectable" || source.InjectableKind != "injectable" {
		t.Fatalf("source identity = %#v", source)
	}
	if source.ObservedCount != 2 || source.IncludedCount != 1 || source.ExcludedCount != 1 {
		t.Fatalf("source counts = %#v", source)
	}
	if !observedInjectionHasCount(source.Tools, "searchWeb", 1) || !observedInjectionHasCount(source.Tools, "readMemory", 1) {
		t.Fatalf("source tools = %#v", source.Tools)
	}
	if !observedInjectionHasBranch(source.Branches, "research", 1, 1, 0) || !observedInjectionHasBranch(source.Branches, "default", 1, 0, 1) {
		t.Fatalf("source branches = %#v", source.Branches)
	}
}

func TestObservedInjectionReadModelComparesRuntimeEvidenceToIndex(t *testing.T) {
	model := observedInjectionReadModel{
		SchemaVersion:     observedInjectionSchemaVersion,
		RunCount:          1,
		ContributionCount: 2,
		Sources: []observedInjectionSource{
			{
				ID:             "injectable:search",
				SourceID:       "injectable:search",
				DefinitionID:   "injectable:search",
				DefinitionKind: "injectable",
				ObservedCount:  1,
				IncludedCount:  1,
				PromptIDs:      []string{"brief.write"},
				RunRefs:        []observedInjectionRunRef{{RunID: "run_1", PromptID: "brief.write"}},
				Tools:          []observedInjectionCount{{Name: "searchWeb", Count: 1}},
			},
			{
				ID:             "injectable:dynamic",
				SourceID:       "injectable:dynamic",
				DefinitionID:   "injectable:dynamic",
				DefinitionKind: "injectable",
				ObservedCount:  1,
				IncludedCount:  1,
				PromptIDs:      []string{"brief.write"},
				RunRefs:        []observedInjectionRunRef{{RunID: "run_1", PromptID: "brief.write"}},
				Tools:          []observedInjectionCount{{Name: "runtimeOnly", Count: 1}},
			},
		},
	}
	index := store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:brief.write", Kind: "prompt", Name: "brief.write"},
			{ID: "injectable:search", Kind: "injectable", Name: "search"},
			{ID: "tool:searchWeb", Kind: "tool", Name: "searchWeb"},
		},
		Relations: []store.ProjectRelation{
			{ID: "r1", Type: "prompt.uses_injectable", From: "prompt:brief.write", To: "injectable:search"},
			{ID: "r2", Type: "injectable.uses_tool", From: "injectable:search", To: "tool:searchWeb"},
		},
	}

	observedInjectionApplyIndexEvidence(&model, index)

	search := observedInjectionSourceByID(model.Sources, "injectable:search")
	if search == nil || search.IndexMatch == nil || search.IndexMatch.Status != "indexed" {
		t.Fatalf("search index match = %#v", search)
	}
	if len(search.IndexMatch.PredictedByPromptIDs) != 1 || search.IndexMatch.PredictedByPromptIDs[0] != "brief.write" {
		t.Fatalf("search prompt prediction = %#v", search.IndexMatch)
	}
	if len(search.ToolIndex) != 1 || search.ToolIndex[0].Status != "predicted" || search.ToolIndex[0].DefinitionID != "tool:searchWeb" {
		t.Fatalf("search tool index = %#v", search.ToolIndex)
	}

	dynamic := observedInjectionSourceByID(model.Sources, "injectable:dynamic")
	if dynamic == nil || dynamic.IndexMatch == nil || dynamic.IndexMatch.Status != "not-indexed" {
		t.Fatalf("dynamic index match = %#v", dynamic)
	}
	if len(dynamic.ToolIndex) != 1 || dynamic.ToolIndex[0].Status != "not-indexed" {
		t.Fatalf("dynamic tool index = %#v", dynamic.ToolIndex)
	}
	if !observedInjectionHasDrift(model.Drift, "runtime.observed_source_not_indexed", "injectable:dynamic", "") {
		t.Fatalf("missing source drift in %#v", model.Drift)
	}
	if !observedInjectionHasDrift(model.Drift, "runtime.observed_tool_not_indexed", "injectable:dynamic", "runtimeOnly") {
		t.Fatalf("missing tool drift in %#v", model.Drift)
	}
}

func TestObservedInjectionReadModelAggregatesPromptInputKeys(t *testing.T) {
	byPrompt := map[string]*observedPromptInputAccumulator{}
	ok := observedInjectionAddPromptInput(byPrompt, map[string]any{
		"kind":             "prompt.input",
		"promptId":         "brief.write",
		"validationStatus": "failed",
		"providedKeys":     []any{"extra"},
		"schemaKeys":       []any{"topic", "count"},
		"requiredKeys":     []any{"topic"},
		"missingKeys":      []any{"topic"},
		"unexpectedKeys":   []any{"extra"},
	}, observedInjectionRunRef{RunID: "run_1", SpanID: "span_1", ArtifactID: "artifact_1"})
	if !ok {
		t.Fatal("expected prompt input preview to be accepted")
	}

	inputs := observedPromptInputs(byPrompt)
	if len(inputs) != 1 {
		t.Fatalf("inputs = %#v", inputs)
	}
	input := inputs[0]
	if input.PromptID != "brief.write" || input.ObservedCount != 1 || input.FailedCount != 1 {
		t.Fatalf("input summary = %#v", input)
	}
	if !observedInjectionHasCount(input.MissingKeys, "topic", 1) {
		t.Fatalf("missing keys = %#v", input.MissingKeys)
	}
	if !observedInjectionHasCount(input.UnexpectedKeys, "extra", 1) {
		t.Fatalf("unexpected keys = %#v", input.UnexpectedKeys)
	}
	if len(input.RunRefs) != 1 || input.RunRefs[0].PromptID != "brief.write" || input.RunRefs[0].State != "failed" {
		t.Fatalf("run refs = %#v", input.RunRefs)
	}
}

func observedInjectionSourceByID(sources []observedInjectionSource, id string) *observedInjectionSource {
	for idx := range sources {
		if sources[idx].SourceID == id {
			return &sources[idx]
		}
	}
	return nil
}

func observedInjectionHasDrift(drift []observedInjectionDrift, kind string, sourceID string, toolName string) bool {
	for _, item := range drift {
		if item.Kind == kind && item.SourceID == sourceID && item.ToolName == toolName {
			return true
		}
	}
	return false
}

func observedInjectionHasCount(counts []observedInjectionCount, name string, count int) bool {
	for _, item := range counts {
		if item.Name == name && item.Count == count {
			return true
		}
	}
	return false
}

func observedInjectionHasBranch(branches []observedInjectionBranchCount, name string, count int, included int, excluded int) bool {
	for _, item := range branches {
		if item.Name == name && item.Count == count && item.IncludedCount == included && item.ExcludedCount == excluded {
			return true
		}
	}
	return false
}
