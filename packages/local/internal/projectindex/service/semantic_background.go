package service

import "context"

// beginBackgroundSemanticTask cancels any older background semantic wave and
// records the cancellation hook for the new one. Syntax/AST work has already
// been published when this is called; only the slower semantic wave is
// superseded.
func (s *Service) beginBackgroundSemanticTask(cancel func()) uint64 {
	if s == nil {
		if cancel != nil {
			cancel()
		}
		return 0
	}
	s.backgroundSemanticMu.Lock()
	defer s.backgroundSemanticMu.Unlock()
	if s.backgroundSemanticCancel != nil {
		s.backgroundSemanticCancel()
	}
	s.backgroundSemanticSeq++
	seq := s.backgroundSemanticSeq
	s.backgroundSemanticCancel = cancel
	return seq
}

func (s *Service) finishBackgroundSemanticTask(seq uint64) {
	if s == nil || seq == 0 {
		return
	}
	s.backgroundSemanticMu.Lock()
	defer s.backgroundSemanticMu.Unlock()
	if s.backgroundSemanticSeq != seq {
		return
	}
	s.backgroundSemanticCancel = nil
}

func (s *Service) newBackgroundSemanticContext() (context.Context, context.CancelFunc, uint64) {
	if s == nil {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		return ctx, cancel, 0
	}
	ctx, cancel := context.WithCancel(s.ctx)
	seq := s.beginBackgroundSemanticTask(cancel)
	return ctx, cancel, seq
}
