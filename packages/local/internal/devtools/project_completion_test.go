package devtools

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectCompletionReusesConfiguredProjectIndexerCompiler(t *testing.T) {
	indexer := &completionProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	result, err := service.CompleteProjectIndex(context.Background(), indexcompletion.View{Generation: 8}, indexcompletion.Request{
		File: "agent.ts", DocumentVersion: 5, LanguageID: "typescript", Limit: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if indexer.completions != 1 || result.Generation != 8 || result.DocumentVersion != 5 {
		t.Fatalf("calls/result = %d %+v, want one query at V5/G8", indexer.completions, result)
	}
}

type completionProjectIndexer struct {
	completions int
}

func (*completionProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *completionProjectIndexer) Completion(context.Context, indexcompletion.CompilerQuery) (indexcompletion.CompilerResponse, error) {
	i.completions++
	return indexcompletion.CompilerResponse{}, nil
}

var _ projectindex.ProjectIndexer = (*completionProjectIndexer)(nil)
