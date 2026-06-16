package server

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestExtractCollectManifests(t *testing.T) {
	stdout := []byte(`{"type":"collect:done","evaluations":[{"schemaVersion":1,"id":"evals.bakeoff","task":{"kind":"prompt"}},{"schemaVersion":1,"id":"prompt.title","future":"field"}],"errors":[]}
{"type":"run:done","experiments":[],"exitCode":0}
`)
	manifests, collectErrors, err := extractCollectManifests(stdout)
	if err != nil {
		t.Fatal(err)
	}
	if len(collectErrors) != 0 {
		t.Errorf("errors: %v", collectErrors)
	}
	if len(manifests) != 2 {
		t.Fatalf("got %d manifests, want 2", len(manifests))
	}
	// Manifests must be verbatim raw JSON — unknown fields survive.
	var probe map[string]any
	if err := json.Unmarshal(manifests[1], &probe); err != nil {
		t.Fatal(err)
	}
	if probe["id"] != "prompt.title" || probe["future"] != "field" {
		t.Errorf("manifest not verbatim: %s", manifests[1])
	}
}

func TestExtractCollectManifestsSurfacesCollectErrors(t *testing.T) {
	stdout := []byte(`{"type":"collect:done","evaluations":[],"errors":[{"message":"duplicate id","file":"a.eval.ts"}]}
`)
	manifests, collectErrors, err := extractCollectManifests(stdout)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifests) != 0 || len(collectErrors) != 1 {
		t.Errorf("manifests=%d errors=%d", len(manifests), len(collectErrors))
	}
}

func TestExtractCollectManifestsWithoutCollectDone(t *testing.T) {
	if _, _, err := extractCollectManifests([]byte("garbage\n")); err == nil {
		t.Error("missing collect:done must error")
	}
}

func TestQualityEvaluationCollectorCachesWithinTTL(t *testing.T) {
	calls := 0
	collector := &QualityEvaluationCollector{
		ttl: time.Hour,
		collect: func(context.Context) ([]json.RawMessage, error) {
			calls++
			return []json.RawMessage{json.RawMessage(`{"id":"evals.bakeoff"}`)}, nil
		},
	}

	for range 3 {
		manifests, err := collector.EvaluationManifests(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(manifests) != 1 {
			t.Fatalf("manifests = %v", manifests)
		}
	}
	if calls != 1 {
		t.Errorf("collect calls = %d, want 1 (TTL cache)", calls)
	}

	collector.ttl = 0
	if _, err := collector.EvaluationManifests(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Errorf("collect calls = %d, want 2 after TTL expiry", calls)
	}
}

func TestQualityEvaluationCollectorServesStaleOnError(t *testing.T) {
	healthy := true
	collector := &QualityEvaluationCollector{
		collect: func(context.Context) ([]json.RawMessage, error) {
			if healthy {
				return []json.RawMessage{json.RawMessage(`{"id":"evals.bakeoff"}`)}, nil
			}
			return nil, errors.New("worker died")
		},
	}

	if _, err := collector.EvaluationManifests(context.Background()); err != nil {
		t.Fatal(err)
	}
	healthy = false
	manifests, err := collector.EvaluationManifests(context.Background())
	if err != nil {
		t.Fatalf("stale cache must be served on collect failure: %v", err)
	}
	if len(manifests) != 1 {
		t.Errorf("manifests = %v", manifests)
	}
}
