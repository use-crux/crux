package quality

import (
	"context"
	"os"
	"path/filepath"
	"testing"

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

	record := `{
	  "schemaVersion": 1,
	  "experimentId": "exp-failed",
	  "evaluationId": "writer.prompt",
	  "qualityId": "q",
	  "startedAt": "2026-05-25T10:00:00Z",
	  "endedAt": "2026-05-25T10:01:00Z",
	  "configFingerprint": "cf",
	  "taskFingerprint": "tf",
	  "filteredRun": false,
	  "replay": { "mode": "live" },
	  "variants": [{ "name": "candidate", "overrideKeys": [] }],
	  "aggregates": { "perVariant": { "candidate": {
	    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
	    "scores": {}, "latency": { "meanMs": 1, "p95Ms": 1 }
	  } } },
	  "gates": { "passed": false, "informational": false, "results": [] },
	  "passed": false,
	  "cells": [{
	    "caseId": "case-1", "variantName": "candidate", "trial": 0, "status": "failed",
	    "input": {}, "scores": [],
	    "assertions": { "ran": 1, "notEvaluated": 0, "outcomes": [] },
	    "durationMs": 1, "traceIds": ["trace-failed"], "capturedSignals": []
	  }]
	}`
	if err := os.MkdirAll(filepath.Join(Dir(dir), "experiments"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(Dir(dir), "experiments", "exp-failed.json"), []byte(record), 0o644); err != nil {
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
