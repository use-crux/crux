package commands

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDevQualityDirRestoresPersistedExperimentsAfterRestart(t *testing.T) {
	root := t.TempDir()
	qualityDir := filepath.Join(root, "var", "quality")
	experimentsDir := filepath.Join(qualityDir, "experiments")
	if err := os.MkdirAll(experimentsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	experiment := []byte(`{
  "schemaVersion": 1,
  "experimentId": "01KTAAAAAAAAAAAAAAAAAAAAAA",
  "evaluationId": "restart.eval",
  "qualityId": "local",
  "startedAt": "2026-07-14T08:00:00Z",
  "endedAt": "2026-07-14T08:00:05Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
    "scores": {}, "latency": { "meanMs": 5, "p95Ms": 5 }
  } } },
  "gates": { "passed": true, "informational": false, "results": [] },
  "passed": true,
  "cells": [{
    "caseId": "case-1", "variantName": "default", "trial": 0, "status": "passed",
    "input": {}, "scores": [], "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 5, "traceIds": ["trace-restart"], "capturedSignals": []
  }]
}`)
	if err := os.WriteFile(filepath.Join(experimentsDir, "01KTAAAAAAAAAAAAAAAAAAAAAA.json"), experiment, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(qualityDir, "activity.jsonl"), []byte(`{"type":"experiment.completed","experimentId":"01KTAAAAAAAAAAAAAAAAAAAAAA"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	previous := resolveProjectConfigForInspect
	t.Cleanup(func() { resolveProjectConfigForInspect = previous })
	resolveProjectConfigForInspect = func(context.Context, string, string, string) (json.RawMessage, error) {
		return json.RawMessage(`{"root":` + mustJSON(t, root) + `,"quality":{"dir":{"value":"var/quality","origin":"config"}}}`), nil
	}

	dir, err := resolveDevQualityDir(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	restarted := quality.NewService(store.NewStore(), dir)
	overview, err := restarted.OverviewRecordAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.ExperimentCount != 1 || overview.LatestExperimentID != "01KTAAAAAAAAAAAAAAAAAAAAAA" || overview.LatestExperimentCompletedAt == "" {
		t.Fatalf("restart overview = %+v, want persisted experiment count and last run", overview)
	}
}

func TestDevQualityDirFallsBackWhenConfigInspectionFails(t *testing.T) {
	root := t.TempDir()
	previous := resolveProjectConfigForInspect
	t.Cleanup(func() { resolveProjectConfigForInspect = previous })

	for _, test := range []struct {
		name    string
		resolve func(context.Context, string, string, string) (json.RawMessage, error)
	}{
		{
			name: "worker failure",
			resolve: func(context.Context, string, string, string) (json.RawMessage, error) {
				return nil, errors.New("worker unavailable")
			},
		},
		{
			name: "invalid payload",
			resolve: func(context.Context, string, string, string) (json.RawMessage, error) {
				return json.RawMessage(`{`), nil
			},
		},
		{
			name: "missing quality",
			resolve: func(context.Context, string, string, string) (json.RawMessage, error) {
				return json.RawMessage(`{}`), nil
			},
		},
		{
			name: "empty quality directory",
			resolve: func(context.Context, string, string, string) (json.RawMessage, error) {
				return json.RawMessage(`{"quality":{"dir":{"value":""}}}`), nil
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolveProjectConfigForInspect = test.resolve
			dir, warning := resolveDevQualityDir(context.Background(), root)
			if want := filepath.Join(root, ".crux", "quality"); dir != want {
				t.Fatalf("quality dir = %q, want %q", dir, want)
			}
			if warning == nil || !strings.Contains(warning.Error(), "using default quality directory") {
				t.Fatalf("warning = %v, want concise fallback warning", warning)
			}
		})
	}
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
