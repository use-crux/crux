package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// The typed experiment detail (served to the TUI and to the web
// ExperimentsView / CellEvidenceView fix-surface UI) must surface the
// core-owned failure artifacts embedded in the record verbatim, so the
// visualization layer renders fix surfaces and provenance without
// re-deriving them (blueprint §12.1/§12.5, I5).
func TestExperimentDetailSurfacesFailureArtifacts(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTFAILUREARTIFACT00000000.json", `{
  "schemaVersion": 2,
  "experimentId": "01KTFAILUREARTIFACT00000000",
  "evaluationId": "evals.bakeoff",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-13T01:00:00.000Z",
  "endedAt": "2026-06-13T01:00:05.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "candidate", "overrideKeys": [] }],
  "aggregates": { "perVariant": {} },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cells": [
    { "caseId": "c1", "variantName": "candidate", "trial": 0, "status": "failed", "input": {},
      "scores": [], "assertions": { "ran": 1, "notEvaluated": 0, "outcomes": [] },
      "durationMs": 9, "traceIds": [], "capturedSignals": [] }
  ],
  "failures": [
    {
      "caseId": "c1",
      "caseName": "refund happy path",
      "variant": "candidate",
      "trial": 0,
      "phase": "expect",
      "input": {},
      "scores": [{ "name": "helpful", "score": 0.7, "baselineScore": 0.84, "delta": -0.14, "rationale": "missed the refund policy" }],
      "failedOutcomes": [],
      "sourceRef": "prompt:support#L4",
      "covers": ["prompt:support"],
      "traceId": "trace-1",
      "spanIds": ["span-1"],
      "cassetteId": "evals.bakeoff",
      "durationMs": 9,
      "datasetProvenance": { "path": "datasets/refunds.jsonl", "contentFingerprint": "sha256:abcd1234" },
      "suggestedFixSurfaces": ["prompt", "retriever"]
    }
  ]
}`)

	svc := NewService(store.NewStore(), dir)
	detail, found, err := svc.ExperimentDetailAPI(context.Background(), "01KTFAILUREARTIFACT00000000")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if len(detail.Failures) != 1 {
		t.Fatalf("failures: got %d want 1: %+v", len(detail.Failures), detail.Failures)
	}
	f := detail.Failures[0]
	if f.CaseID != "c1" || f.CaseName != "refund happy path" || f.Variant != "candidate" || f.Trial != 0 {
		t.Errorf("identity: %+v", f)
	}
	if f.Phase != "expect" {
		t.Errorf("phase: %q", f.Phase)
	}
	if len(f.SuggestedFixSurfaces) != 2 || f.SuggestedFixSurfaces[0] != "prompt" || f.SuggestedFixSurfaces[1] != "retriever" {
		t.Errorf("fix surfaces: %+v", f.SuggestedFixSurfaces)
	}
	if len(f.Covers) != 1 || f.Covers[0] != "prompt:support" || f.SourceRef != "prompt:support#L4" {
		t.Errorf("covers/sourceRef: %+v / %q", f.Covers, f.SourceRef)
	}
	if f.CassetteID != "evals.bakeoff" || f.TraceID != "trace-1" {
		t.Errorf("cassette/trace: %q / %q", f.CassetteID, f.TraceID)
	}
	if f.DatasetProvenance == nil || f.DatasetProvenance.ContentFingerprint != "sha256:abcd1234" || f.DatasetProvenance.Path != "datasets/refunds.jsonl" {
		t.Errorf("dataset provenance: %+v", f.DatasetProvenance)
	}
	if len(f.Scores) != 1 || f.Scores[0].Name != "helpful" || f.Scores[0].Score == nil || *f.Scores[0].Score != 0.7 {
		t.Errorf("scores: %+v", f.Scores)
	}
	if f.Scores[0].BaselineScore == nil || *f.Scores[0].BaselineScore != 0.84 || f.Scores[0].Delta == nil || *f.Scores[0].Delta != -0.14 {
		t.Errorf("score deltas: %+v", f.Scores[0])
	}
	if f.Scores[0].Rationale != "missed the refund policy" {
		t.Errorf("rationale: %q", f.Scores[0].Rationale)
	}
}
