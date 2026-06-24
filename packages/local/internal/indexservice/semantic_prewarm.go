package indexservice

import (
	"context"
)

func (s *Service) startProjectSemanticPrewarm(ctx context.Context, mode ProjectSemanticExecutionMode) {
	if mode == ProjectSemanticDisabled {
		return
	}
	if _, ok := s.indexer.(SemanticClient); !ok {
		return
	}
	prewarmer, ok := s.indexer.(SemanticPrewarmer)
	if !ok {
		return
	}
	go func() {
		_ = prewarmer.PrewarmProjectSemantic(ctx)
	}()
}
