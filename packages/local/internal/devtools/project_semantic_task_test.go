package devtools

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPlannedProjectSemanticUsesOuterContextForPlanning(t *testing.T) {
	indexer := &semanticTaskContextIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
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
	if indexer.planRemaining <= projectIndexSemanticTimeout {
		t.Fatalf("plan context remaining = %s, want outer reindex context instead of semantic timeout", indexer.planRemaining)
	}
	if indexer.semanticRemaining <= 0 || indexer.semanticRemaining > projectIndexSemanticTimeout {
		t.Fatalf("semantic context remaining = %s, want semantic timeout", indexer.semanticRemaining)
	}
}

type semanticTaskContextIndexer struct {
	planRemaining     time.Duration
	semanticRemaining time.Duration
}

func (i *semanticTaskContextIndexer) IndexProjectAstPatch(context.Context, string, string, string) (IndexPatch, error) {
	return IndexPatch{}, nil
}

func (i *semanticTaskContextIndexer) PlanProjectSemanticRequest(ctx context.Context, root, configPath, projectName string) (ProjectSemanticIndexRequest, error) {
	if deadline, ok := ctx.Deadline(); ok {
		i.planRemaining = time.Until(deadline)
	}
	return ProjectSemanticIndexRequest{Root: root, ConfigPath: configPath, ProjectName: projectName}, nil
}

func (i *semanticTaskContextIndexer) IndexProjectSemanticPatch(ctx context.Context, _ ProjectSemanticIndexRequest) (IndexPatch, error) {
	if deadline, ok := ctx.Deadline(); ok {
		i.semanticRemaining = time.Until(deadline)
	}
	return IndexPatch{SchemaVersion: 1, Phase: indexPatchPhaseSemantic, Status: "ok"}, nil
}
