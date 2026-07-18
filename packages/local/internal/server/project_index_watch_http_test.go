package server

import (
	"context"
	"encoding/json"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPServer_project_index_watch_endpoint_returns_idle_status(t *testing.T) {
	s := store.NewStore()
	devSvc := devtools.NewService(s, inspect.NewService(s, inspect.Dir(t.TempDir())))
	srv := NewHTTPServerWithServices(devSvc, ServerOptions{InspectDir: t.TempDir()})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/project/index/watch")
	if err != nil {
		t.Fatalf("GET project index watch error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET project index watch status = %d, want 200", resp.StatusCode)
	}

	var status api.ProjectIndexWatchStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatalf("decode watch status: %v", err)
	}
	if status.State != "idle" || status.LastRun != nil {
		t.Fatalf("watch status = %+v, want idle status without last run", status)
	}
}

func TestHTTPServer_project_index_watch_endpoint_returns_last_run_status(t *testing.T) {
	root := t.TempDir()
	previous := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
			Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
		},
		Sources: []store.IndexSourceFile{{File: "src/a.ts", Status: "indexed", ShardID: "."}},
	}
	indexer := &fakeIncrementalProjectIndexer{
		result: projectindex.ProjectIndexIncrementalResult{
			Report: projectindex.ProjectIndexIncrementalReport{
				PlanKind:              "source-file-reindex",
				GraphConfidence:       "complete-enough-for-source-closure",
				ChangedFiles:          []string{"src/a.ts"},
				DeletedFiles:          []string{"src/deleted.ts"},
				AffectedFiles:         []string{"src/a.ts"},
				AffectedDefinitionIDs: []string{"prompt:a"},
				DurationMsByPhase:     map[string]float64{"planning": 1.25, "ast": 2.5},
			},
			Patches: []projectindex.IndexPatch{{
				SchemaVersion: 1,
				Phase:         "ast",
				Project:       store.ProjectIdentity{Root: root, Name: "project"},
				Status:        "ok",
				Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"src/a.ts"}},
				Facts:         projectindex.IndexPatchFacts{},
			}},
		},
	}
	s := store.NewStore()
	devSvc := devtools.NewService(s, inspect.NewService(s, inspect.Dir(t.TempDir()))).WithProjectIndexer(indexer)
	devSvc.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       *previous.Project,
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts: projectindex.IndexPatchFacts{
			Sources:     previous.Sources,
			SourceGraph: previous.SourceGraph,
		},
	})
	_, err := devSvc.ReindexProjectIncrementalWithOptions(
		context.Background(),
		root,
		"",
		"project",
		[]string{"src/a.ts"},
		[]string{"src/deleted.ts"},
		devtools.ProjectReindexOptions{
			Semantic: devtools.ProjectSemanticDisabled,
			Watch: devtools.ProjectWatchRunOptions{
				RunID:                   42,
				DeltaBatchCount:         3,
				CoalescedWhileRunning:   true,
				PendingRunReplacedCount: 2,
			},
		},
	)
	if err != nil {
		t.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
	}

	srv := NewHTTPServerWithServices(devSvc, ServerOptions{InspectDir: t.TempDir()})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/project/index/watch")
	if err != nil {
		t.Fatalf("GET project index watch error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET project index watch status = %d, want 200", resp.StatusCode)
	}

	var status api.ProjectIndexWatchStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		t.Fatalf("decode watch status: %v", err)
	}
	if status.State != "idle" || status.LastRun == nil {
		t.Fatalf("watch status = %+v, want idle status with last run", status)
	}
	last := status.LastRun
	if last.RunID != 42 || last.PlanKind != "source-file-reindex" || last.SemanticStatus != "disabled" {
		t.Fatalf("last run = %+v, want run 42 source-file disabled semantic", last)
	}
	if last.ChangedFileCount != 1 || last.DeletedFileCount != 1 || last.AffectedFileCount != 1 || last.AffectedDefinitionCount != 1 {
		t.Fatalf("last counts = %+v", last)
	}
	if !last.CoalescedWhileRunning || last.DeltaBatchCount != 3 || last.PendingRunReplacedCount != 2 {
		t.Fatalf("last queue = %+v", last)
	}
	if last.PhaseTimingsMs["planning"] != 1.25 || last.PhaseTimingsMs["ast"] != 2.5 {
		t.Fatalf("phase timings = %+v", last.PhaseTimingsMs)
	}
}
