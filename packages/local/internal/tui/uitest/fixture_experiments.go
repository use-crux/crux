package uitest

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (c *FixtureClient) ExperimentSummaries(context.Context) ([]api.QualityExperimentSummary, error) {
	return []api.QualityExperimentSummary{c.fixtureExperimentSummary()}, nil
}

func (c *FixtureClient) ExperimentDetail(context.Context, string) (api.QualityExperimentDetail, bool, error) {
	return c.fixtureExperimentDetail(), true, nil
}

func (c *FixtureClient) EvaluationProgress(context.Context, string, int) (api.QualityEvaluationProgress, bool, error) {
	return api.QualityEvaluationProgress{
		Tag:           "QualityEvaluationProgress",
		SchemaVersion: 1,
		EvaluationID:  "agent-loops",
		GeneratedAt:   c.Now.Format(time.RFC3339Nano),
		Limit:         4,
		Runs: []api.QualityEvaluationProgressRun{
			{ExperimentID: "baseline-014", Verdict: "passed", PassRate: 0.96},
			{ExperimentID: "exp-043", Verdict: "running", PassRate: 0.75},
		},
	}, true, nil
}

func (c *FixtureClient) fixtureExperimentSummary() api.QualityExperimentSummary {
	return api.QualityExperimentSummary{
		ExperimentID:    "exp-043",
		EvaluationID:    "agent-loops",
		QualityID:       "quality:docs_agent",
		ExperimentLabel: "agent-loops",
		StartedAt:       c.Now.Add(-6 * time.Minute).Format(time.RFC3339Nano),
		Status:          "running",
		ReplayMode:      "replay",
		Variants:        []string{"baseline-014", "maxIter=3", "dedupe=0.92", "maxIter+dedupe"},
		Cells:           16,
		CellsPassed:     12,
		GatesPassed:     true,
		Passed:          false,
	}
}

func (c *FixtureClient) fixtureExperimentDetail() api.QualityExperimentDetail {
	costBase, costWinner := 0.55, 0.49
	return api.QualityExperimentDetail{
		SchemaVersion:   1,
		ExperimentID:    "exp-043",
		EvaluationID:    "agent-loops",
		QualityID:       "quality:docs_agent",
		ExperimentLabel: "agent-loops",
		StartedAt:       c.Now.Add(-6 * time.Minute).Format(time.RFC3339Nano),
		Replay:          api.QualityExperimentReplay{Mode: "replay", Cassette: "fixtures/triage"},
		BaselineRef:     &api.QualityExperimentBaselineRef{BaselineID: "baseline-014", ExperimentID: "baseline-014", VariantName: "baseline-014"},
		Variants: []api.QualityExperimentVariantDecl{
			{Name: "baseline-014"},
			{Name: "maxIter=3", Overrides: map[string]any{"agent.retrieve.maxIterations": 3}},
			{Name: "dedupe=0.92", Overrides: map[string]any{"retrieval.dedupe.embedding": 0.92}},
			{Name: "maxIter+dedupe", Overrides: map[string]any{"agent.retrieve.maxIterations": 3, "retrieval.dedupe.embedding": 0.92}},
		},
		Aggregates: api.QualityExperimentAggregates{PerVariant: map[string]api.QualityVariantAggregate{
			"baseline-014":   fixtureVariantAggregate(4, 4, 0.96, 0.80, 4500, &costBase),
			"maxIter=3":      fixtureVariantAggregate(4, 3, 0.91, 0.76, 4300, nil),
			"dedupe=0.92":    fixtureVariantAggregate(4, 4, 0.95, 0.79, 4200, nil),
			"maxIter+dedupe": fixtureVariantAggregate(4, 4, 0.97, 0.82, 4100, &costWinner),
		}},
		Cells: []api.QualityExperimentCell{
			{
				CaseID:      "rag/typed_prompts_definition",
				VariantName: "maxIter=3",
				Status:      "failed",
				TraceIDs:    []string{"8af2f1c"},
				Assertions: api.QualityCellAssertions{
					Outcomes: []api.QualityAssertionOutcome{{Status: "failed", Matcher: "toBe", Message: "citation_required failed"}},
				},
			},
		},
		Gates: api.QualityExperimentGates{Passed: true},
	}
}

func fixtureVariantAggregate(cells, passed int, passRate, score, p95 float64, cost *float64) api.QualityVariantAggregate {
	return api.QualityVariantAggregate{
		Cells:    cells,
		Passed:   passed,
		Failed:   cells - passed,
		PassRate: passRate,
		Scores:   map[string]api.QualityScoreStats{"overall": {Mean: score, SEM: 0.02, N: cells}},
		Latency:  api.QualityLatencyStats{P95Ms: p95},
		CostUsd:  cost,
	}
}
