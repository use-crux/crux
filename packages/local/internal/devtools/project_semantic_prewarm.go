package devtools

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

// ProjectSemanticPrewarmer optionally starts the semantic backend before its
// request payload is ready. Implementations must not mutate Project Index
// state; the real semantic request remains the only source of semantic facts.
type ProjectSemanticPrewarmer interface {
	PrewarmProjectSemantic(ctx context.Context) error
}

func (s *Service) startProjectSemanticPrewarm(ctx context.Context, mode ProjectSemanticExecutionMode) {
	if mode == ProjectSemanticDisabled {
		return
	}
	if _, ok := s.indexer.(projectindex.ProjectSemanticIndexer); !ok {
		return
	}
	prewarmer, ok := s.indexer.(ProjectSemanticPrewarmer)
	if !ok {
		return
	}
	go func() {
		_ = prewarmer.PrewarmProjectSemantic(ctx)
	}()
}
