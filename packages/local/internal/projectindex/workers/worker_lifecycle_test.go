package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
)

func TestWorkerConstructionDoesNotStartNodePhaseWorkers(t *testing.T) {
	root := t.TempDir()
	worker := New(BundleOptions{
		ProjectIndexerScript:         filepath.Join(root, "missing-project-indexer.mjs"),
		ProjectSemanticIndexerScript: filepath.Join(root, "missing-project-semantic-indexer.mjs"),
		ProjectRuntimeIndexerScript:  filepath.Join(root, "missing-project-runtime-indexer.mjs"),
	})

	if err := worker.Close(); err != nil {
		t.Fatalf("Close after construction error = %v, want no Node phase worker to start before a phase request", err)
	}
}

func TestWorkerCloseOwnsNativeSyntaxParserLifetime(t *testing.T) {
	parser := &closingSyntaxParser{}
	worker := (&Bundle{}).WithSyntaxParser(parser)

	if err := worker.Close(); err != nil {
		t.Fatalf("Close error = %v", err)
	}
	if parser.closed != 1 {
		t.Fatalf("syntax parser close calls = %d, want 1", parser.closed)
	}
}

type closingSyntaxParser struct {
	closed int
}

func (p *closingSyntaxParser) ParseFile(context.Context, frontend.Request) (json.RawMessage, error) {
	return nil, fmt.Errorf("ParseFile should not be called by lifecycle test")
}

func (p *closingSyntaxParser) Concurrency() int {
	return 1
}

func (p *closingSyntaxParser) Close() error {
	p.closed++
	return nil
}
