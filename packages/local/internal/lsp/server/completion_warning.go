package server

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const (
	completionWarningCooldown = 5 * time.Minute
	completionFailureWarning  = "Crux completion is temporarily unavailable. TypeScript completion is unaffected."
)

func (s *Server) warnCompletionFailure(ctx context.Context) {
	now := s.options.Now()
	s.completionMu.Lock()
	if !s.lastCompletionWarning.IsZero() &&
		now.Before(s.lastCompletionWarning.Add(completionWarningCooldown)) {
		s.completionMu.Unlock()
		return
	}
	s.lastCompletionWarning = now
	s.completionMu.Unlock()

	s.Notify(ctx, protocol.MethodShowMessage, protocol.LogMessageParams{
		Type: protocol.MessageTypeWarning, Message: completionFailureWarning,
	})
}
