package indexservice

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPlannedProjectSemanticUsesOuterContextForPlanning(t *testing.T) {
	indexer := &semanticTaskContextIndexer{}
	service := New(Options{Store: store.NewStore()}).WithProjectIndexer(indexer)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	task := service.startPlannedProjectSemanticPatch(ctx, ProjectSemanticInline, "/repo", "", "project")
	if task == nil {
		t.Fatal("startPlannedProjectSemanticPatch returned nil")
	}
	result := task.wait()
	if result.err != nil {
		t.Fatalf("planned semantic task error = %v", result.err)
	}
	if indexer.planRemaining <= ProjectIndexSemanticTimeout {
		t.Fatalf("plan context remaining = %s, want outer reindex context instead of semantic timeout", indexer.planRemaining)
	}
	if indexer.semanticRemaining <= 0 || indexer.semanticRemaining > ProjectIndexSemanticTimeout {
		t.Fatalf("semantic context remaining = %s, want semantic timeout", indexer.semanticRemaining)
	}
}

type semanticTaskContextIndexer struct {
	planRemaining     time.Duration
	semanticRemaining time.Duration
}

func (i *semanticTaskContextIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *semanticTaskContextIndexer) PlanProjectSemanticRequest(ctx context.Context, root, configPath, projectName string) (projectindex.ProjectSemanticIndexRequest, error) {
	if deadline, ok := ctx.Deadline(); ok {
		i.planRemaining = time.Until(deadline)
	}
	return projectindex.ProjectSemanticIndexRequest{Root: root, ConfigPath: configPath, ProjectName: projectName}, nil
}

func (i *semanticTaskContextIndexer) IndexProjectSemanticPatch(ctx context.Context, _ projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if deadline, ok := ctx.Deadline(); ok {
		i.semanticRemaining = time.Until(deadline)
	}
	return projectindex.IndexPatch{SchemaVersion: 1, Phase: projectindex.PhaseSemantic, Status: "ok"}, nil
}
