package devtools

import (
	"context"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type benchmarkWatchProjectIndexer struct {
	result projectindex.ProjectIndexIncrementalResult
}

func (i benchmarkWatchProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i benchmarkWatchProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	return i.result, nil
}

func BenchmarkReindexProjectIncrementalWatchCommit(b *testing.B) {
	root := b.TempDir()
	changedFile := fmt.Sprintf("%s/src/file-000.ts", root)
	previous := benchmarkWatchIndex(root, 500)
	indexer := benchmarkWatchProjectIndexer{
		result: projectindex.ProjectIndexIncrementalResult{
			Report: projectindex.ProjectIndexIncrementalReport{
				PlanKind:               "source-file-reindex",
				GraphConfidence:        "complete-enough-for-source-closure",
				ChangedFiles:           []string{changedFile},
				AffectedFiles:          []string{changedFile},
				AffectedDefinitionIDs:  []string{"prompt:file-000"},
				PatchCounts:            projectindex.ProjectIndexPatchCounts{AST: 1, Total: 1},
				SourceProfileFileCount: 1,
				SemanticStatus:         "not-requested",
			},
			Patches: []projectindex.IndexPatch{{
				SchemaVersion: 1,
				Phase:         projectindex.PhaseAST,
				Project:       store.ProjectIdentity{Root: root, Name: "benchmark"},
				Status:        "ok",
				Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{changedFile}},
				Facts: projectindex.IndexPatchFacts{
					Definitions: []store.ProjectDefinition{
						{
							ID:       "prompt:file-000.updated",
							Kind:     "prompt",
							Name:     "file-000.updated",
							Fidelity: "partial",
							Status:   "active",
							Source:   &store.SourceLoc{File: changedFile, Line: 2},
						},
					},
					Sources: []store.IndexSourceFile{
						{
							File:          changedFile,
							Status:        "indexed",
							ShardID:       ".",
							DefinitionIDs: []string{"prompt:file-000.updated"},
							Dependencies:  []string{},
							Dependents:    []string{},
						},
					},
				},
			}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(previous, projectindex.PhaseAST, "ok"))

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := service.ReindexProjectIncrementalWithOptions(
			context.Background(),
			root,
			"",
			"benchmark",
			[]string{changedFile},
			nil,
			ProjectReindexOptions{
				Semantic: ProjectSemanticDisabled,
				Watch: ProjectWatchRunOptions{
					RunID:           uint64(i + 1),
					DeltaBatchCount: 1,
				},
			},
		)
		if err != nil {
			b.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
		}
	}
	b.StopTimer()

	status, err := service.ProjectIndexWatchStatus(context.Background())
	if err != nil {
		b.Fatalf("ProjectIndexWatchStatus error = %v", err)
	}
	if status.LastRun == nil || status.LastRun.PatchCount == 0 {
		b.Fatalf("watch status = %+v, want last patch count", status)
	}
}

func benchmarkWatchIndex(root string, count int) store.IndexData {
	definitions := make([]store.ProjectDefinition, 0, count)
	sources := make([]store.IndexSourceFile, 0, count)
	for index := 0; index < count; index++ {
		file := fmt.Sprintf("%s/src/file-%03d.ts", root, index)
		definitionID := fmt.Sprintf("prompt:file-%03d", index)
		definitions = append(definitions, store.ProjectDefinition{
			ID:       definitionID,
			Kind:     "prompt",
			Name:     fmt.Sprintf("file-%03d", index),
			Fidelity: "partial",
			Status:   "active",
			Source:   &store.SourceLoc{File: file, Line: 1},
		})
		sources = append(sources, store.IndexSourceFile{
			File:          file,
			Status:        "indexed",
			ShardID:       ".",
			DefinitionIDs: []string{definitionID},
			Dependencies:  []string{},
			Dependents:    []string{},
		})
	}
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "benchmark"},
		Definitions:   definitions,
		Sources:       sources,
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@crux/indexer",
			Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
			Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
		},
	}
}
