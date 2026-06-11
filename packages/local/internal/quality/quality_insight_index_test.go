package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestInsightsLinkIndexDefinitionsAndSources(t *testing.T) {
	dir := t.TempDir()
	s := store.NewStore()
	s.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer.prompt",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Source:   &store.SourceLoc{File: "src/writer.ts", Line: 12},
			},
		},
	})
	service := NewService(s, Dir(dir))

	experiment := qualityExperimentRecord{
		Tag:       "QualityExperiment",
		ID:        "exp-failed",
		QualityID: "q",
		Suite:     qualityExperimentSuite{ID: "suite-1", CaseCount: 1},
		StartedAt: "2026-05-25T10:00:00Z",
		EndedAt:   "2026-05-25T10:01:00Z",
		Status:    "completed",
		Summary: struct {
			Total   int `json:"total"`
			Passed  int `json:"passed"`
			Failed  int `json:"failed"`
			Errored int `json:"errored"`
		}{Total: 1, Failed: 1},
		Variants: []qualityExperimentVariant{{ID: "candidate", TargetID: "writer.prompt"}},
		Cases:    []qualityExperimentCase{{CaseID: "case-1", VariantID: "candidate", Status: "failed", TraceID: "trace-failed"}},
	}
	if err := qualityfs.Open(Dir(dir)).WriteRecord(qualityfs.KindExperiments, experiment.ID, experiment); err != nil {
		t.Fatalf("write experiment: %v", err)
	}

	insights, err := service.Insights(context.Background())
	if err != nil {
		t.Fatalf("Insights() error: %v", err)
	}
	insight := insightByID(insights, "experiment-exp-failed")
	if insight == nil {
		t.Fatalf("experiment insight not found: %+v", insights)
	}
	if len(insight.LinkedDefinitionIDs) != 1 || insight.LinkedDefinitionIDs[0] != "prompt:writer.prompt" {
		t.Fatalf("linked definitions = %+v", insight.LinkedDefinitionIDs)
	}
	if len(insight.LinkedSources) != 1 || insight.LinkedSources[0].File != "src/writer.ts" || insight.LinkedSources[0].Line != 12 {
		t.Fatalf("linked sources = %+v", insight.LinkedSources)
	}
}

func insightByID(insights []qualityInsightRecord, id string) *qualityInsightRecord {
	for i := range insights {
		if insights[i].InsightID == id {
			return &insights[i]
		}
	}
	return nil
}
