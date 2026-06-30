package observability

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailExplainsFreshnessAndCacheGating(t *testing.T) {
	started := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	runID := "run_freshness_cache"
	traceID := "trace_freshness_cache"
	generation := requestGenerationSpan(runID, traceID, "span_generation", "", "generate freshness answer", started, "freshness.answer")

	graph := Graph{
		Run: RunSummary{
			RunID:         runID,
			TraceID:       traceID,
			Name:          "freshness cache",
			RootPrimitive: "generation.call",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{generation},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact(runID, traceID, "artifact_messages", "span_generation", started, "Base prompt.", "context:live", "artifact_context_live"),
			freshnessContextArtifact(runID, traceID, "artifact_context_live", "span_context_live", started, "context:live", true, "active", "miss", "fresh"),
			freshnessContextArtifact(runID, traceID, "artifact_context_stale", "span_context_stale", started, "context:stale", false, "dropped-stale", "hit", "stale-rejected"),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge(runID, traceID, "edge_messages", "span_generation", "artifact_messages", started),
			requestConsumedContextEdge(runID, traceID, "edge_context_live", "artifact_context_live", "span_generation", started),
			requestConsumedContextEdge(runID, traceID, "edge_context_stale", "artifact_context_stale", "span_generation", started),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	report := detail.Root.DecisionReport
	if report == nil {
		t.Fatal("decision report is nil")
	}

	live := findSawItem(report.Saw, "context:live")
	if live == nil || live.Freshness == nil || live.Freshness.Status != "fresh" {
		t.Fatalf("live saw row = %#v, want fresh evidence", live)
	}
	if live.Cache == nil || live.Cache.Status != "miss" || !live.Cache.AcceptedByFreshness || live.Cache.RejectedByFreshness {
		t.Fatalf("live cache evidence = %#v, want miss accepted by freshness", live.Cache)
	}

	stale := findConsideredItem(report.Considered, "context:stale")
	if stale == nil || stale.ReasonState != "stale-rejected" || stale.Freshness == nil || stale.Freshness.Status != "stale-rejected" {
		t.Fatalf("stale considered row = %#v, want stale rejection evidence", stale)
	}
	if stale.Cache == nil || stale.Cache.Status != "hit" || !stale.Cache.RejectedByFreshness || stale.Cache.AcceptedByFreshness {
		t.Fatalf("stale cache evidence = %#v, want hit rejected by freshness", stale.Cache)
	}

	assertDecisionReason(t, report.Decisions, "decision:span_generation:context:stale", "context.freshness.stale_rejected", "declared")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:cache:context:live", "cache.freshness.accepted", "declared")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:cache:context:stale", "cache.freshness.rejected", "declared")

	if !hasFreshnessStatus(report.Freshness, "context:live", "fresh") || !hasFreshnessStatus(report.Freshness, "context:stale", "stale-rejected") {
		t.Fatalf("freshness evidence = %#v, want fresh and stale-rejected rows", report.Freshness)
	}
	if hasDiagnosticCode(report.Gaps, "freshness.not-recorded") {
		t.Fatalf("gaps = %#v, did not want freshness missing when all context freshness is recorded", report.Gaps)
	}
}

func freshnessContextArtifact(runID, traceID, artifactID, spanID string, created time.Time, sourceID string, included bool, state string, cacheStatus string, freshnessStatus string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"kind":           "context.contribution",
		"state":          state,
		"included":       included,
		"sourceId":       sourceID,
		"injectableKind": "context",
		"reason":         state,
		"tokens":         3,
		"cache": map[string]any{
			"status": cacheStatus,
			"key":    "cache:" + sourceID,
			"ageMs":  2_000,
			"ttlMs":  60_000,
			"reason": cacheStatus,
		},
		"freshness": map[string]any{
			"status":        freshnessStatus,
			"ageMs":         2_000,
			"maxAgeMs":      60_000,
			"observedAt":    created.Add(-2 * time.Second).Format(time.RFC3339Nano),
			"validUntil":    created.Add(time.Minute).Format(time.RFC3339Nano),
			"sourceVersion": "v1",
			"reason":        freshnessStatus,
		},
		"text": "Context for " + sourceID,
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "context.contribution",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func findSawItem(items []TurnSawItem, id string) *TurnSawItem {
	for index := range items {
		if items[index].ID == id {
			return &items[index]
		}
	}
	return nil
}

func findConsideredItem(items []TurnConsideredItem, id string) *TurnConsideredItem {
	for index := range items {
		if items[index].ID == id {
			return &items[index]
		}
	}
	return nil
}

func hasFreshnessStatus(rows []TurnFreshnessEvidence, subjectID string, status string) bool {
	for _, row := range rows {
		if row.Subject.ID == subjectID && row.Status == status {
			return true
		}
	}
	return false
}

func hasDiagnosticCode(rows []TurnDecisionDiagnostic, code string) bool {
	for _, row := range rows {
		if row.Code == code {
			return true
		}
	}
	return false
}
